/**
 * Admin callables — role/claim management.
 *
 * setUserRole writes the role to users/{uid} AND mirrors it into a custom
 * auth claim so firestore.rules can check `request.auth.token.role` without
 * an extra read. Only directors/lieutenants (per the RBAC matrix) may call it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { notify, notifyAdmins } from '../gjallarhorn/notify';
import { renderEmail, detailRows, escapeHtml } from '../gjallarhorn/templates';
import type { AcademyDoc, Role } from '../types';
import { ADMIN_ROLES, STAFF_ROLES } from '../types';

/**
 * Reject a caller whose account is suspended/deactivated. These callables
 * authorize from the caller's Firestore role, which PERSISTS through suspension
 * (only `status` changes) — so a role check alone would still let a suspended
 * admin act until their token expires. Call right after loading the caller doc.
 */
function assertActiveCaller(data: { status?: unknown } | undefined): void {
  if (data?.status === 'suspended' || data?.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active. Contact Academy Leadership.');
  }
}

/** Production sign-in URL used in account emails. */
const SITE_URL = 'https://heimdallscheduling.com';

const VALID_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator', 'instructor', 'guest'];

/**
 * FDLE high-liability courses + recommended instructor-to-student ratio
 * (FAC 11B-35.0021(8), effective 2025). null = the rule is per-vehicle, not a
 * student ratio (Vehicle Operations). Includes the legacy First Aid number
 * CJK0044 (current editions renumber First Aid to CJK0031). Verified against
 * primary regulatory text via research (2026-06-18).
 */
const FDLE_HIGH_LIABILITY: Record<string, number | null> = {
  CJK0040: 6, // Criminal Justice Firearms — ≤6 students per instructor on the range
  CJK0051: 8, // Criminal Justice Defensive Tactics — 8:1
  CJK0020: null, // (LE) Vehicle Operations — ≥1 instructor per vehicle (no student ratio)
  CJK0031: 10, // First Aid for Criminal Justice Officers — 10:1
  CJK0044: 10, // First Aid (legacy CJK number) — 10:1
};

/** Flag FDLE high-liability courses + fill the recommended instructor ratio (by
 *  CJK), without clobbering any custom ratio the user already set. */
function applyFdleHighLiability(courses: Record<string, unknown>[]): Record<string, unknown>[] {
  return (courses ?? []).map((c) => {
    const cjk = String((c.cjk as string) ?? '').toUpperCase().replace(/\s/g, '');
    if (!(cjk in FDLE_HIGH_LIABILITY)) return c;
    const ratio = FDLE_HIGH_LIABILITY[cjk];
    return {
      ...c,
      highLiability: true,
      ...(ratio != null && c.instructorRatio == null ? { instructorRatio: ratio } : {}),
    };
  });
}

export const setUserRole = onCall<{ uid: string; role: Role }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');

  // Authorize from the caller's Firestore profile (claims may lag on first use).
  const callerDoc = await getFirestore().doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may assign roles.');
  }
  assertActiveCaller(callerDoc.data());

  const { uid, role } = request.data;
  if (!uid || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', 'Provide a uid and a valid role.');
  }
  // Lieutenant and director are intentionally equal in authority (both in
  // ADMIN_ROLES), so either may assign any role — including director. No
  // director-only restriction here, by design.

  // Preserve the user's tenant + platform claims — setCustomUserClaims REPLACES
  // all claims, so a role change must not drop orgId / platformOwner. When the
  // target has NO org yet (e.g. a self-registered user being given a role),
  // they inherit the assigning admin's org — this is the onboarding path that
  // keeps them from being locked out by the org-isolation rules. An existing
  // orgId is never reassigned across tenants.
  const targetSnap = await getFirestore().doc(`users/${uid}`).get();
  const tdata = targetSnap.data() ?? {};
  const callerOrgId = callerDoc.data()?.orgId as string | undefined;
  // Cross-tenant guard: an admin may only change roles for users in their own org
  // (the platform owner may act anywhere). An org-less target is still allowed —
  // that's the onboarding inherit path below.
  const callerIsPlatformOwner = callerDoc.data()?.platformOwner === true;
  if (!callerIsPlatformOwner && tdata.orgId && tdata.orgId !== callerOrgId) {
    throw new HttpsError('permission-denied', 'That user belongs to another organization.');
  }
  const effectiveOrgId = (tdata.orgId as string | undefined) ?? callerOrgId;
  const claims: Record<string, unknown> = { role };
  if (effectiveOrgId) claims.orgId = effectiveOrgId;
  if (tdata.platformOwner === true) claims.platformOwner = true;
  await getAuth().setCustomUserClaims(uid, claims);
  await getFirestore().doc(`users/${uid}`).set(
    {
      role,
      // Only write orgId when the target lacked one (joining the admin's org);
      // never overwrite an existing tenant.
      ...(!tdata.orgId && effectiveOrgId ? { orgId: effectiveOrgId } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await getFirestore().collection('auditLog').add({
    actorUid: caller.uid,
    action: 'admin.set_role',
    targetType: 'user',
    targetId: uid,
    summary: `Role set to ${role}`,
    ...(effectiveOrgId ? { orgId: effectiveOrgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/**
 * Admin-created account. Creates the Firebase Auth user with a temporary
 * password (default "123456" — Firebase's 6-char minimum) and the matching
 * users/{uid} profile, pre-approved (status:'active') with the chosen role and
 * mustChangePassword:true so the recruit is forced to set their own password on
 * first sign-in. Runs on the Admin SDK, so the calling admin stays signed in as
 * themselves (unlike client-side createUserWithEmailAndPassword). This is the
 * single entry point the bulk spreadsheet import will loop over.
 */
const DEFAULT_TEMP_PASSWORD = '123456';

export const createUserAccount = onCall<{
  email: string;
  displayName: string;
  role: Role;
  rank?: string;
  agency?: string;
  phone?: string;
  password?: string;
}>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');

  const callerDoc = await getFirestore().doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may add users.');
  }
  assertActiveCaller(callerDoc.data());
  // New users inherit the creating admin's tenant (undefined pre-backfill — no change then).
  const callerOrgId = callerDoc.data()?.orgId as string | undefined;

  const email = (request.data.email ?? '').trim().toLowerCase();
  const displayName = (request.data.displayName ?? '').trim();
  const { role } = request.data;
  const password = (request.data.password ?? '').trim() || DEFAULT_TEMP_PASSWORD;
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');
  if (!displayName) throw new HttpsError('invalid-argument', 'A display name is required.');
  if (!VALID_ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Pick a valid role.');
  if (password.length < 6) throw new HttpsError('invalid-argument', 'Temporary password must be at least 6 characters.');

  let uid: string;
  let adopted = false;
  try {
    const created = await getAuth().createUser({ email, password, displayName });
    uid = created.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      // The Auth account outlived its Firestore profile — e.g. the profile was
      // deleted directly in the database (Auth users live in Firebase Auth, not
      // Firestore). Adopt the orphaned Auth user instead of failing, but ONLY if
      // there's genuinely no profile for it; a live profile is a real duplicate.
      const existing = await getAuth().getUserByEmail(email);
      const profileSnap = await getFirestore().doc(`users/${existing.uid}`).get();
      if (profileSnap.exists) throw new HttpsError('already-exists', `An account already exists for ${email}.`);
      await getAuth().updateUser(existing.uid, { password, displayName });
      uid = existing.uid;
      adopted = true;
    } else if (code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', `"${email}" is not a valid email address.`);
    } else if (code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'Temporary password must be at least 6 characters.');
    } else {
      throw new HttpsError('internal', (err as Error).message || 'Failed to create the account.');
    }
  }

  await getAuth().setCustomUserClaims(uid, { role, ...(callerOrgId ? { orgId: callerOrgId } : {}) });
  await getFirestore().doc(`users/${uid}`).set({
    email,
    displayName,
    photoURL: '',
    phone: (request.data.phone ?? '').trim(),
    rank: (request.data.rank ?? '').trim(),
    agency: (request.data.agency ?? '').trim(),
    role,
    ...(callerOrgId ? { orgId: callerOrgId } : {}),
    status: 'active',
    qualifications: [],
    verifiedQualKeys: [],
    notificationPrefs: { email: true, reminderLeadHours: 48, digest: true },
    mustChangePassword: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await getFirestore().collection('auditLog').add({
    actorUid: caller.uid,
    action: 'admin.create_user',
    targetType: 'user',
    targetId: uid,
    summary: `${adopted ? 'Re-created (adopted orphaned login for)' : 'Created'} ${displayName} (${role})`,
    ...(callerOrgId ? { orgId: callerOrgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, uid };
});

/**
 * One-time bootstrap: promote the FIRST user to director when no director
 * exists yet. Lets a fresh deployment self-serve its initial admin without
 * touching the console. No-ops once a director exists.
 */
export const bootstrapFirstDirector = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const dbRef = getFirestore();
  // Closed once ANY account exists. In a pooled multi-tenant DB a per-org
  // "no director yet" check would let any signed-in user self-promote to
  // director of an empty/new org — so gate on global emptiness. New orgs get
  // their first admin via createOrg (platform-owner provisioned).
  const anyUser = await dbRef.collection('users').limit(1).get();
  if (!anyUser.empty) {
    throw new HttpsError('failed-precondition', 'Bootstrap is closed — an account already exists.');
  }

  const uid = request.auth.uid;
  await getAuth().setCustomUserClaims(uid, { role: 'director' });
  await dbRef.doc(`users/${uid}`).set(
    { role: 'director', status: 'active', updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await dbRef.collection('auditLog').add({
    actorUid: uid,
    action: 'admin.bootstrap_director',
    targetType: 'user',
    targetId: uid,
    summary: 'Bootstrapped first director account',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * Provision a new tenant (org). Platform-owner only — the product owner creates
 * colleges/agencies. Generates a non-enumerable orgId (shortCode + 6 hex) and,
 * optionally, seats a first admin (captain/director) into it. Does NOT change
 * any existing org's data — pooled isolation is enforced by rules (Phase 5).
 */
export const createOrg = onCall<{
  shortCode: string;
  legalName: string;
  firstAdminUid?: string;
  allowedEmailDomains?: string[];
  jurisdiction?: 'FL' | 'neutral';
}>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may create organizations.');
  }

  const legalName = (request.data.legalName ?? '').trim();
  const slug = (request.data.shortCode ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12);
  if (!slug) throw new HttpsError('invalid-argument', 'shortCode must contain letters or digits.');
  if (!legalName) throw new HttpsError('invalid-argument', 'legalName is required.');
  const domains = (request.data.allowedEmailDomains ?? [])
    .map((d) => String(d).trim().toLowerCase())
    .filter(Boolean);
  const jurisdiction = request.data.jurisdiction === 'FL' ? 'FL' : 'neutral';

  // Allocate a unique id; re-check existence inside a transaction (collision-safe).
  let orgId = '';
  for (let attempt = 0; attempt < 6 && !orgId; attempt++) {
    const candidate = `${slug}-${randomBytes(3).toString('hex')}`;
    const ok = await db.runTransaction(async (tx) => {
      const ref = db.doc(`orgs/${candidate}`);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, {
        orgId: candidate,
        shortCode: slug,
        legalName,
        status: 'active',
        // Compliance (Phase 13): US data residency for CJIS; DPA starts unaccepted
        // so the new tenant is prompted to accept it on the Compliance page.
        dataRegion: 'us-east1',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });
      return true;
    });
    if (ok) orgId = candidate;
  }
  if (!orgId) throw new HttpsError('internal', 'Could not allocate a unique org id; please retry.');

  // Seed a minimal settings doc so the org has branding + join config from day one
  // (the admin refines the rest in Org Settings). Required GlobalSettings fields only.
  await db.doc(`settings/${orgId}`).set(
    {
      orgName: legalName,
      brandPrimaryColor: '#16203a',
      brandAccentColor: '#d99320',
      logoUrl: '',
      allowedEmailDomains: domains,
      payPeriodTargetHours: 85,
      jurisdiction,
      letterheadTagline: '',
      siteCode: '',
    },
    { merge: true }
  );

  // Platform FDLE curricula (the five programs) are NOT copied into each org.
  // They live once in `defaultCurricula` and every org reads them read-only as the
  // single source of truth; an org adds only its OWN curricula in `curricula`
  // (resolution in src/lib/curricula.ts). New orgs therefore start with no
  // org-curricula and inherit the five platform programs automatically.

  // Optionally seat the first admin, preserving their other claims.
  const firstAdminUid = (request.data.firstAdminUid ?? '').trim();
  if (firstAdminUid) {
    const adminUser = await getAuth().getUser(firstAdminUid).catch(() => null);
    if (!adminUser) throw new HttpsError('not-found', 'firstAdminUid does not match an existing account.');
    // Set claims explicitly (don't spread the account's old claims): a fresh
    // role+orgId, preserving only platformOwner. Avoids carrying a stale role or
    // foreign orgId into the new tenant (see [[org-transition-strip-role-claim]]).
    const wasOwner = (adminUser.customClaims ?? {}).platformOwner === true;
    await getAuth().setCustomUserClaims(firstAdminUid, { role: 'director', orgId, ...(wasOwner ? { platformOwner: true } : {}) });
    await db.doc(`users/${firstAdminUid}`).set(
      { role: 'director', orgId, status: 'active', updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  await db.collection('auditLog').add({
    actorUid: caller.uid,
    action: 'platform.create_org',
    targetType: 'org',
    targetId: orgId,
    summary: `Created org ${legalName} (${orgId})`,
    orgId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, orgId };
});

/**
 * Send (or re-send) a SignUpGenius-migration activation email to a user the
 * admin just created. Carries the temporary password chosen at creation so the
 * recruit can sign in and is then forced to set their own. Admin-only; writes a
 * `mail` doc directly (the Trigger Email extension sends it) — this is an
 * explicit, on-demand action, so it bypasses the per-automation toggles.
 */
export const sendActivationEmail = onCall<{ uid: string; password: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may send activation emails.');
  }
  assertActiveCaller(callerDoc.data());

  const uid = (request.data.uid ?? '').trim();
  const password = (request.data.password ?? '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.');
  if (!password) throw new HttpsError('invalid-argument', 'Missing temporary password.');

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const user = userSnap.data() as { email?: string; displayName?: string; orgId?: string };
  const email = (user.email ?? '').trim();
  const displayName = (user.displayName ?? '').trim() || 'there';
  if (!email) throw new HttpsError('failed-precondition', 'That user has no email on file.');

  const settingsSnap = await db.doc(`settings/${user.orgId || 'global'}`).get();
  const orgName = settingsSnap.exists ? ((settingsSnap.data()!.orgName as string) || 'the Training Academy') : 'the Training Academy';

  const creds = detailRows([
    ['Sign-in email', email],
    ['Temporary password', password],
  ]);
  const safeName = escapeHtml(displayName);
  const content = renderEmail({
    subject: `[HEIMDALL] Activate your ${orgName} account`,
    heading: 'Activate your account',
    bodyHtml:
      `Hi ${safeName},<br/><br/>` +
      `An account was created for you through HEIMDALL — a Coordinated Academy, Duty, &amp; Roster Engine (CADRE) ` +
      `because we're migrating our class sign-ups over from SignUpGenius. ` +
      `To activate your account, sign in with the temporary password below — you'll be prompted to choose your own password the first time you log in.<br/><br/>` +
      creds.html,
    bodyText:
      `Hi ${displayName},\n\n` +
      `An account was created for you through HEIMDALL — a Coordinated Academy, Duty, & Roster Engine (CADRE) ` +
      `because we're migrating our class sign-ups over from SignUpGenius. ` +
      `To activate your account, sign in with the temporary password below — you'll be prompted to choose your own password the first time you log in.\n\n` +
      `${creds.text}\n\nSign in: ${SITE_URL}`,
    ctaLabel: 'Sign in to activate',
    ctaUrl: SITE_URL,
    orgName,
    logoUrl: settingsSnap.data()?.logoUrl as string | undefined,
  });

  await db.collection('mail').add({
    to: [email],
    message: { subject: content.subject, html: content.html, text: content.text },
    ...(user.orgId ? { orgId: user.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('auditLog').add({
    actorUid: caller.uid,
    action: 'admin.send_activation',
    targetType: 'user',
    targetId: uid,
    summary: `Sent activation email to ${email}`,
    ...(user.orgId ? { orgId: user.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/**
 * Suspend (or reinstate) a member. Suspended users can still sign in but see a
 * site-wide banner telling them to contact Academy Leadership; the reason is
 * stored on the profile and shown to them and to admins. Emails + in-app
 * notifies the member either way. Admin-only.
 */
/**
 * Activate / deactivate a member. Like suspension, deactivation must strip the
 * role claim + revoke refresh tokens server-side — a client status write alone
 * leaves the live token with full rule authority. Same-org (or platform owner).
 */
export const setUserActive = onCall<{ uid: string; active: boolean }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may activate or deactivate members.');
  }
  assertActiveCaller(callerDoc.data());

  const uid = (request.data.uid ?? '').trim();
  const active = !!request.data.active;
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.');
  if (uid === caller.uid) throw new HttpsError('failed-precondition', 'You cannot change your own account status.');

  const targetSnap = await db.doc(`users/${uid}`).get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const target = targetSnap.data()!;
  const callerOrgId = callerDoc.data()?.orgId as string | undefined;
  const callerIsOwner = callerDoc.data()?.platformOwner === true;
  if (!callerIsOwner && target.orgId && target.orgId !== callerOrgId) {
    throw new HttpsError('permission-denied', 'That user belongs to another organization.');
  }

  await db.doc(`users/${uid}`).set({ status: active ? 'active' : 'inactive', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const claims = { ...((await getAuth().getUser(uid).catch(() => null))?.customClaims ?? {}) } as Record<string, unknown>;
  if (active) {
    delete claims.status;
    const restoredRole = target.role as Role | undefined;
    await getAuth().setCustomUserClaims(uid, { ...claims, ...(restoredRole ? { role: restoredRole } : {}) });
  } else {
    delete claims.role;
    claims.status = 'inactive'; // rules' activeStatus() blocks future tokens
    await getAuth().setCustomUserClaims(uid, claims);
    await getAuth().revokeRefreshTokens(uid);
  }

  await db.collection('auditLog').add({
    actorUid: caller.uid,
    action: active ? 'admin.activate_user' : 'admin.deactivate_user',
    targetType: 'user',
    targetId: uid,
    summary: active ? `Activated ${target.displayName ?? uid}` : `Deactivated ${target.displayName ?? uid}`,
    ...(target.orgId ? { orgId: target.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const setUserSuspension = onCall<{ uid: string; suspended: boolean; reason?: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may suspend members.');
  }
  assertActiveCaller(callerDoc.data());

  const uid = (request.data.uid ?? '').trim();
  const suspended = !!request.data.suspended;
  const reason = (request.data.reason ?? '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.');
  if (uid === caller.uid) throw new HttpsError('failed-precondition', 'You cannot suspend your own account.');
  if (suspended && !reason) throw new HttpsError('invalid-argument', 'A suspension reason is required.');

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const user = userSnap.data() as { email?: string; displayName?: string; orgId?: string };
  const displayName = (user.displayName ?? '').trim() || 'there';

  await db.doc(`users/${uid}`).set(
    suspended
      ? {
          status: 'suspended',
          suspensionReason: reason,
          suspendedAt: FieldValue.serverTimestamp(),
          suspendedBy: caller.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }
      : {
          status: 'active',
          suspensionReason: FieldValue.delete(),
          suspendedAt: FieldValue.delete(),
          suspendedBy: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
    { merge: true }
  );

  // Enforce on the LIVE session: stripping the role claim removes staff/admin
  // authority from the rules (which trust the claim), and revoking refresh tokens
  // forces re-auth; restore the role claim on reinstate. Without this a suspended
  // member's existing token keeps full DB write access until it expires.
  const claims = { ...((await getAuth().getUser(uid).catch(() => null))?.customClaims ?? {}) } as Record<string, unknown>;
  if (suspended) {
    delete claims.role;
    claims.status = 'suspended'; // rules' activeStatus() blocks future tokens
    await getAuth().setCustomUserClaims(uid, claims);
    await getAuth().revokeRefreshTokens(uid);
  } else {
    delete claims.status;
    const restoredRole = userSnap.data()!.role as Role | undefined;
    await getAuth().setCustomUserClaims(uid, { ...claims, ...(restoredRole ? { role: restoredRole } : {}) });
  }

  const settingsSnap = await db.doc(`settings/${(user as { orgId?: string }).orgId || 'global'}`).get();
  const orgName = settingsSnap.exists ? ((settingsSnap.data()!.orgName as string) || 'the Training Academy') : 'the Training Academy';

  if (suspended) {
    await notify({
      uid,
      type: 'account_suspended',
      title: 'Your account has been suspended',
      body: `Your ${orgName} account has been suspended. Reason: ${reason}\n\nPlease contact Academy Leadership to resolve this.`,
      link: '/profile',
      force: true, // suspension notices must reach the member regardless of opt-outs
    });
  } else {
    await notify({
      uid,
      type: 'account_reinstated',
      title: 'Your account has been reinstated',
      body: `Your ${orgName} account access has been restored. Welcome back, ${displayName}.`,
      link: '/',
      force: true,
    });
  }

  await db.collection('auditLog').add({
    actorUid: caller.uid,
    action: suspended ? 'admin.suspend_user' : 'admin.reinstate_user',
    targetType: 'user',
    targetId: uid,
    summary: suspended ? `Suspended ${displayName}: ${reason}` : `Reinstated ${displayName}`,
    ...(user.orgId ? { orgId: user.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/**
 * Academy approval chain: coordinator submits → Sergeant → Lieutenant → Captain
 * (director) → approved, then the coordinator may publish. An approver can send
 * it back with "changes requested." Each transition is performed here (Admin
 * SDK) so only the right person at the right step can advance it, and so the
 * publish gate in firestore.rules cannot be side-stepped. Notifies the next
 * approver (or, at the end, the submitting coordinator).
 */
export const academyApproval = onCall<{
  academyId: string;
  action: 'submit' | 'approve' | 'request_changes' | 'force';
  sergeantId?: string;
  note?: string;
}>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerSnap = await db.doc(`users/${caller.uid}`).get();
  const callerRole = callerSnap.exists ? (callerSnap.data()!.role as Role) : null;
  const callerName = callerSnap.exists ? ((callerSnap.data()!.displayName as string) || 'A member') : 'A member';
  if (!callerRole) throw new HttpsError('permission-denied', 'No profile found.');
  assertActiveCaller(callerSnap.data());
  const callerUid = caller.uid;

  const { academyId, action, note } = request.data;
  if (!academyId) throw new HttpsError('invalid-argument', 'Missing academy.');
  const ref = db.doc(`academies/${academyId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Academy not found.');
  const academy = snap.data() as AcademyDoc;
  if (academy.isTemplate) throw new HttpsError('failed-precondition', 'Templates do not go through approval.');
  // Cross-tenant guard: only command within the academy's OWN org may drive its
  // approval (the platform owner may act anywhere).
  {
    const callerOrgId = callerSnap.data()?.orgId as string | undefined;
    const callerIsOwner = callerSnap.data()?.platformOwner === true;
    if (!callerIsOwner && (!academy.orgId || academy.orgId !== callerOrgId)) {
      throw new HttpsError('permission-denied', 'This academy belongs to another organization.');
    }
  }

  const cur = academy.approval?.state ?? 'not_submitted';
  const label = academy.shortName || academy.name;
  const link = `/cadre/academies/${academyId}`;
  const prevHistory = academy.approval?.history ?? [];
  const now = Timestamp.now();
  const step = (decision: string) => ({ uid: callerUid, name: callerName, role: callerRole, decision, ...(note ? { note } : {}), at: now });

  // The single active user holding a command role IN THIS ACADEMY'S ORG (there
  // is exactly one each per org). Scoped by orgId so a pooled DB doesn't find
  // command across tenants (which would throw "exactly one" or route cross-org).
  async function single(role: Role): Promise<{ uid: string; name: string }> {
    let query: FirebaseFirestore.Query = db.collection('users').where('role', '==', role).where('status', '==', 'active');
    if (academy.orgId) query = query.where('orgId', '==', academy.orgId);
    const q = await query.get();
    if (q.empty) throw new HttpsError('failed-precondition', `No active ${role} exists to route to — add one first.`);
    if (q.size > 1) throw new HttpsError('failed-precondition', `There must be exactly one ${role}; found ${q.size}.`);
    return { uid: q.docs[0].id, name: (q.docs[0].data().displayName as string) || role };
  }

  async function commit(approval: AcademyDoc['approval'], notifyFn: () => Promise<void>) {
    await ref.update({ approval, updatedAt: FieldValue.serverTimestamp() });
    await notifyFn();
    await db.collection('auditLog').add({
      actorUid: callerUid,
      action: `academy.approval.${action}`,
      targetType: 'academy',
      targetId: academyId,
      summary: `${callerName}: ${action} → ${approval!.state} (${label})`,
      ...(academy.orgId ? { orgId: academy.orgId } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, state: approval!.state };
  }

  if (action === 'submit') {
    if (!STAFF_ROLES.includes(callerRole)) throw new HttpsError('permission-denied', 'Only staff may submit a class for approval.');
    if (cur !== 'not_submitted' && cur !== 'changes_requested') {
      throw new HttpsError('failed-precondition', `This class is already in approval (${cur}).`);
    }
    const sergeantId = request.data.sergeantId;
    if (!sergeantId) throw new HttpsError('invalid-argument', 'Choose a sergeant to route this to.');
    const sgt = await db.doc(`users/${sergeantId}`).get();
    if (!sgt.exists || sgt.data()!.role !== 'sergeant') throw new HttpsError('invalid-argument', 'Pick a valid sergeant.');
    return commit(
      { state: 'pending_sergeant', sergeantId, submittedBy: callerUid, history: [...prevHistory, step('submitted')] },
      () => notify({ uid: sergeantId, type: 'approval_request', title: `Approval needed: ${label}`, body: `${callerName} submitted "${label}" for your sergeant sign-off.`, link })
    );
  }

  if (action === 'approve') {
    if (cur === 'pending_sergeant') {
      if (callerUid !== academy.approval?.sergeantId) throw new HttpsError('permission-denied', 'Only the assigned sergeant may approve this step.');
      const lt = await single('lieutenant');
      return commit(
        { ...academy.approval!, state: 'pending_lieutenant', history: [...prevHistory, step('approved')] },
        () => notify({ uid: lt.uid, type: 'approval_request', title: `Approval needed: ${label}`, body: `Sergeant ${callerName} approved "${label}". It now needs your (lieutenant) sign-off.`, link })
      );
    }
    if (cur === 'pending_lieutenant') {
      if (callerRole !== 'lieutenant') throw new HttpsError('permission-denied', 'Only the lieutenant may approve this step.');
      const cap = await single('director');
      return commit(
        { ...academy.approval!, state: 'pending_captain', history: [...prevHistory, step('approved')] },
        () => notify({ uid: cap.uid, type: 'approval_request', title: `Approval needed: ${label}`, body: `Lt. ${callerName} approved "${label}". It now needs your (captain) final sign-off.`, link })
      );
    }
    if (cur === 'pending_captain') {
      if (callerRole !== 'director') throw new HttpsError('permission-denied', 'Only the captain may give final approval.');
      const approval = { ...academy.approval!, state: 'approved' as const, history: [...prevHistory, step('approved')] };
      return commit(approval, () =>
        approval.submittedBy
          ? notify({ uid: approval.submittedBy, type: 'approval_update', title: `Approved: ${label}`, body: `Capt. ${callerName} gave final approval for "${label}". You can now publish it to the calendar.`, link })
          : Promise.resolve()
      );
    }
    throw new HttpsError('failed-precondition', `Nothing to approve at this stage (${cur}).`);
  }

  if (action === 'force') {
    // Fast-track: a higher rank pushes the workflow up to the rank above THEM,
    // skipping the rank below — to speed things up. Also allowed after a class was
    // sent back ('changes_requested'), so command can re-advance it without a full
    // resubmit + re-route through the sergeant.
    if (cur !== 'pending_sergeant' && cur !== 'pending_lieutenant' && cur !== 'changes_requested') {
      throw new HttpsError('failed-precondition', `Nothing to fast-track at this stage (${cur}).`);
    }
    const approvalBase = { ...(academy.approval ?? {}), submittedBy: academy.approval?.submittedBy ?? callerUid };
    if (callerRole === 'lieutenant') {
      // Lieutenant → captain, bypassing the sergeant step.
      const cap = await single('director');
      return commit(
        { ...approvalBase, state: 'pending_captain', history: [...prevHistory, step('forced')] },
        () => notify({ uid: cap.uid, type: 'approval_request', title: `Approval needed: ${label}`, body: `Lt. ${callerName} fast-tracked "${label}" past the sergeant step. It now needs your (captain) final sign-off.`, link })
      );
    }
    if (callerRole === 'sergeant') {
      // A sergeant pushes the sergeant step to the lieutenant (any sergeant; also
      // from changes_requested) without waiting on the assigned sergeant.
      if (cur !== 'pending_sergeant' && cur !== 'changes_requested') {
        throw new HttpsError('failed-precondition', 'This class is already past the sergeant step.');
      }
      const lt = await single('lieutenant');
      return commit(
        { ...approvalBase, state: 'pending_lieutenant', history: [...prevHistory, step('forced')] },
        () => notify({ uid: lt.uid, type: 'approval_request', title: `Approval needed: ${label}`, body: `Sergeant ${callerName} fast-tracked "${label}". It now needs your (lieutenant) sign-off.`, link })
      );
    }
    throw new HttpsError('permission-denied', 'Only a sergeant or lieutenant may fast-track approval.');
  }

  if (action === 'request_changes') {
    const isActiveApprover =
      (cur === 'pending_sergeant' && callerUid === academy.approval?.sergeantId) ||
      (cur === 'pending_lieutenant' && callerRole === 'lieutenant') ||
      (cur === 'pending_captain' && callerRole === 'director');
    if (!isActiveApprover) throw new HttpsError('permission-denied', 'Only the current approver may request changes.');
    const approval = { ...academy.approval!, state: 'changes_requested' as const, changesNote: note ?? '', history: [...prevHistory, step('changes_requested')] };
    return commit(approval, () =>
      approval.submittedBy
        ? notify({ uid: approval.submittedBy, type: 'approval_update', title: `Changes requested: ${label}`, body: `${callerName} requested changes on "${label}"${note ? `: ${note}` : '.'} Update it and resubmit.`, link })
        : Promise.resolve()
    );
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

/**
 * Cross-org feedback for the PLATFORM OWNER (the universal "report a problem"
 * view). Returns every org's bug/feature reports — but STRIPS screenshotUrls for
 * orgs OTHER than the owner's own, because those images can carry roster PII
 * (SSNs, etc.). That redaction happens HERE, server-side, so the owner's client
 * never even receives a cross-tenant screenshot URL (the storage rules would
 * block direct access too — defense in depth). The owner's own org's reports
 * come back whole (they already see those via the normal admin view). Read-only:
 * triage of another org's report stays with that org's admins.
 */
export const listAllFeedback = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may view cross-org feedback.');
  }
  const callerOrgId = callerDoc.data()?.orgId as string | undefined;

  const [reportsSnap, orgsSnap] = await Promise.all([
    db.collection('feedbackReports').orderBy('createdAt', 'desc').limit(1000).get(),
    db.collection('orgs').get(),
  ]);
  const orgName = new Map<string, string>();
  orgsSnap.docs.forEach((o) => orgName.set(o.id, (o.data().legalName as string) || o.id));

  // Explicit projection (don't over-return); Timestamps → millis so they survive
  // the callable wire intact.
  const reports = reportsSnap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>;
    const sameOrg = !!callerOrgId && r.orgId === callerOrgId;
    const shots = Array.isArray(r.screenshotUrls) ? (r.screenshotUrls as string[]) : [];
    return {
      id: d.id,
      orgId: (r.orgId as string) ?? null,
      orgName: orgName.get(r.orgId as string) ?? ((r.orgId as string) || 'Unassigned'),
      kind: r.kind ?? 'bug',
      title: r.title ?? '',
      description: r.description ?? '',
      severity: r.severity ?? 'low',
      area: r.area ?? '',
      stepsToReproduce: r.stepsToReproduce ?? '',
      expected: r.expected ?? '',
      actual: r.actual ?? '',
      status: r.status ?? 'new',
      submittedByName: r.submittedByName ?? '',
      submittedByRole: r.submittedByRole ?? '',
      submittedByEmail: r.submittedByEmail ?? '',
      createdAtMs: (r.createdAt as { toMillis?: () => number })?.toMillis?.() ?? null,
      // PII posture: only the owner's OWN org's screenshots are returned; others
      // are withheld (count only).
      ...(sameOrg ? { screenshotUrls: shots } : { screenshotsWithheld: shots.length }),
    };
  });
  return { reports };
});

// ── Onboarding: site-code join + platform-owner queue ─────────────────────────

/** Find the single org whose settings.siteCode matches (trimmed, case-insensitive). */
async function findOrgIdBySiteCode(code: string): Promise<string | null> {
  const norm = code.trim().toLowerCase();
  if (!norm) return null;
  const snap = await getFirestore().collection('settings').get();
  const matches = snap.docs.filter(
    (d) => d.id !== 'global' && String((d.data().siteCode as string) ?? '').trim().toLowerCase() === norm
  );
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * A signed-in, ORG-LESS user joins an org by its site code → routed into that
 * org's PENDING queue (an admin still approves + assigns a role). Already-assigned
 * users cannot hop orgs with a code.
 */
export const joinOrgByCode = onCall<{ code: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const me = (await db.doc(`users/${caller.uid}`).get()).data() ?? {};
  if (me.orgId) throw new HttpsError('failed-precondition', 'Your account already belongs to an organization.');
  if (me.status === 'suspended') throw new HttpsError('permission-denied', 'This account is suspended.');

  const code = (request.data.code ?? '').trim();
  if (!code) throw new HttpsError('invalid-argument', 'Enter a join code.');
  const orgId = await findOrgIdBySiteCode(code);
  if (!orgId) throw new HttpsError('not-found', 'That code did not match any organization.');

  // Stamp the tenant claim + doc (claim first so the live session refreshes in),
  // clear any prior denial. Stays pending — an admin approves AND assigns the
  // role. CRITICAL: strip any stale `role` claim/field. firestore.rules derives
  // admin/staff rights from the token role alone (not doc status), so a role
  // carried over from a prior org would grant unapproved access here.
  const existing = { ...((await getAuth().getUser(caller.uid).catch(() => null))?.customClaims ?? {}) } as Record<string, unknown>;
  delete existing.role;
  await getAuth().setCustomUserClaims(caller.uid, { ...existing, orgId });
  await db.doc(`users/${caller.uid}`).set(
    { orgId, role: FieldValue.delete(), deniedFromOrgId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await notifyAdmins(
    {
      dedupeKey: `join_${caller.uid}_${orgId}`,
      type: 'new_account_pending',
      title: 'New account request',
      body: `${me.displayName || me.email || 'A user'} joined via site code and is awaiting approval.`,
      link: '/admin/users',
    },
    orgId
  );
  return { ok: true, orgId };
});

/** Platform owner assigns an account to an org (+ optional role) — the owner-queue action. */
export const assignUserToOrg = onCall<{ uid: string; orgId: string; role?: Role }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may assign accounts to organizations.');
  }
  const { uid, orgId, role } = request.data;
  if (!uid || !orgId) throw new HttpsError('invalid-argument', 'Provide a user and an organization.');
  if (role && !VALID_ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Invalid role.');
  if (!(await db.doc(`orgs/${orgId}`).get()).exists) throw new HttpsError('not-found', 'That organization does not exist.');

  // Strip any stale role first; set it only if the owner explicitly chose one
  // (otherwise the account lands role-less + pending for the org admin to assign).
  const existing = { ...((await getAuth().getUser(uid).catch(() => null))?.customClaims ?? {}) } as Record<string, unknown>;
  delete existing.role;
  await getAuth().setCustomUserClaims(uid, { ...existing, orgId, ...(role ? { role } : {}) });
  await db.doc(`users/${uid}`).set(
    { orgId, ...(role ? { role } : { role: FieldValue.delete() }), deniedFromOrgId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'platform.assign_org', targetType: 'user', targetId: uid,
    summary: `Assigned to org ${orgId}${role ? ` as ${role}` : ''}`, orgId, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * Deny a pending account: clears its org (bounces it back to the platform owner's
 * queue) and records the denying org. Caller must be an admin of the account's
 * CURRENT org, or the platform owner.
 */
export const denyUser = onCall<{ uid: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerData = (await db.doc(`users/${caller.uid}`).get()).data() ?? {};
  assertActiveCaller(callerData);
  const { uid } = request.data;
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.');
  if (uid === caller.uid) throw new HttpsError('failed-precondition', 'You cannot deny your own account.');

  const target = (await db.doc(`users/${uid}`).get()).data();
  if (!target) throw new HttpsError('not-found', 'User not found.');
  // Deny acts only on accounts AWAITING approval. Removing an already-active
  // member is deactivate/suspend, not deny — and gating on 'pending' also stops a
  // suspended member being bounced to a clean pending state (suspension escape).
  if (target.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only accounts awaiting approval can be denied.');
  }
  const isOwner = callerData.platformOwner === true;
  const sameOrgAdmin = ADMIN_ROLES.includes(callerData.role as Role) && !!callerData.orgId && callerData.orgId === target.orgId;
  if (!isOwner && !sameOrgAdmin) {
    throw new HttpsError('permission-denied', "Only this organization's admins or the platform owner may deny this account.");
  }

  const fromOrg = target.orgId as string | undefined;
  // Clear the tenant + role claim/field → the account is org-less and role-less
  // again (owner queue); it can re-enter a different site code. Stripping role is
  // essential: the rules trust the token role, so a retained role would grant
  // access on the next org this account joins.
  const existing = ((await getAuth().getUser(uid).catch(() => null))?.customClaims ?? {}) as Record<string, unknown>;
  delete existing.orgId;
  delete existing.role;
  await getAuth().setCustomUserClaims(uid, existing);
  await db.doc(`users/${uid}`).set(
    { orgId: FieldValue.delete(), role: FieldValue.delete(), status: 'pending', ...(fromOrg ? { deniedFromOrgId: fromOrg } : {}), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'admin.deny_user', targetType: 'user', targetId: uid,
    summary: `Denied join${fromOrg ? ` to ${fromOrg}` : ''}`, ...(fromOrg ? { orgId: fromOrg } : {}), createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** Platform-owner queue: org-less accounts (awaiting assignment, incl. denied) + an org summary. */
export const listOwnerQueue = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may view the owner queue.');
  }
  const [usersSnap, orgsSnap] = await Promise.all([db.collection('users').get(), db.collection('orgs').get()]);
  const orgName = new Map(orgsSnap.docs.map((o) => [o.id, (o.data().legalName as string) || o.id]));
  const counts: Record<string, number> = {};
  usersSnap.docs.forEach((d) => {
    const o = d.data().orgId as string | undefined;
    if (o) counts[o] = (counts[o] ?? 0) + 1;
  });
  const queue = usersSnap.docs
    .filter((d) => !d.data().orgId)
    .map((d) => {
      const u = d.data();
      const denied = u.deniedFromOrgId as string | undefined;
      return {
        uid: d.id,
        email: (u.email as string) ?? '',
        displayName: (u.displayName as string) ?? '',
        status: (u.status as string) ?? 'pending',
        deniedFromOrgName: denied ? orgName.get(denied) ?? denied : null,
        createdAtMs: (u.createdAt as { toMillis?: () => number })?.toMillis?.() ?? null,
      };
    });
  const orgs = orgsSnap.docs.map((o) => ({ orgId: o.id, legalName: orgName.get(o.id)!, userCount: counts[o.id] ?? 0 }));
  return { queue, orgs };
});

// ── Owner console v2: org drill-down, admin provisioning, cross-org audit ─────

/** Platform-owner: full detail for one org — settings summary + member roster + counts. */
export const getOrgDetail = onCall<{ orgId: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may view organization detail.');
  }
  const orgId = (request.data.orgId ?? '').trim();
  if (!orgId) throw new HttpsError('invalid-argument', 'Missing organization.');
  const orgSnap = await db.doc(`orgs/${orgId}`).get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'That organization does not exist.');
  const [settingsSnap, usersSnap] = await Promise.all([
    db.doc(`settings/${orgId}`).get(),
    db.collection('users').where('orgId', '==', orgId).get(),
  ]);
  const members = usersSnap.docs.map((d) => {
    const u = d.data();
    return {
      uid: d.id,
      displayName: (u.displayName as string) ?? '',
      email: (u.email as string) ?? '',
      role: (u.role as string) ?? '',
      status: (u.status as string) ?? 'pending',
      rank: (u.rank as string) ?? '',
    };
  });
  const s = settingsSnap.data() ?? {};
  const o = orgSnap.data()!;
  return {
    org: {
      orgId,
      legalName: (o.legalName as string) || orgId,
      status: (o.status as string) ?? 'active',
      suspendedReason: (o.suspendedReason as string) ?? '',
      shortCode: (o.shortCode as string) ?? '',
      // Compliance (Phase 13) — owner oversight of each org's DPA acceptance.
      dataRegion: (o.dataRegion as string) ?? '',
      dpaAcceptedAt: (o.dpaAcceptedAt as Timestamp | undefined)?.toMillis?.() ?? null,
      dpaAcceptedByName: (o.dpaAcceptedByName as string) ?? '',
      dpaVersion: (o.dpaVersion as string) ?? '',
      complimentary: (o.complimentary as boolean) === true,
      billingEnabled: (o.billingEnabled as boolean) === true,
      subscriptionStatus: (o.subscriptionStatus as string) ?? 'none',
    },
    settings: {
      orgName: (s.orgName as string) ?? '',
      allowedEmailDomains: (s.allowedEmailDomains as string[]) ?? [],
      siteCode: (s.siteCode as string) ?? '',
      jurisdiction: (s.jurisdiction as string) ?? '',
    },
    members,
    memberCount: members.length,
    pendingCount: members.filter((m) => m.status === 'pending').length,
  };
});

/**
 * Platform-owner: mark an org complimentary (never billed, never gated) or revert.
 * Complimentary is checked first in billing everywhere — the founding PHSC beta
 * gets this so a billing lapse / Stripe mishap can never restrict it.
 */
export const setOrgComplimentary = onCall<{ orgId: string; complimentary: boolean }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may change complimentary status.');
  }
  const orgId = (request.data.orgId ?? '').trim();
  if (!orgId) throw new HttpsError('invalid-argument', 'Missing organization.');
  const orgRef = db.doc(`orgs/${orgId}`);
  if (!(await orgRef.get()).exists) throw new HttpsError('not-found', 'That organization does not exist.');
  const complimentary = !!request.data.complimentary;
  await orgRef.set({ complimentary }, { merge: true });
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'org.set_complimentary', targetType: 'org', targetId: orgId,
    summary: `Set complimentary = ${complimentary}`, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, complimentary };
});

/**
 * Platform-owner: suspend an org (its members are locked out at sign-in via the
 * RequireAuth org-status check — the live org doc drives it in real time) or
 * reactivate it. A COMPLIMENTARY org cannot be suspended, which protects the
 * founding PHSC beta.
 */
export const setOrgSuspension = onCall<{ orgId: string; suspended: boolean; reason?: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may suspend an organization.');
  }
  const orgId = (request.data.orgId ?? '').trim();
  const suspended = !!request.data.suspended;
  const reason = (request.data.reason ?? '').trim();
  if (!orgId) throw new HttpsError('invalid-argument', 'Missing organization.');
  if (suspended && !reason) throw new HttpsError('invalid-argument', 'A suspension reason is required.');
  const orgRef = db.doc(`orgs/${orgId}`);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'That organization does not exist.');
  // Never suspend a complimentary org (protects the founding PHSC beta).
  if (suspended && orgSnap.data()?.complimentary === true) {
    throw new HttpsError('failed-precondition', 'A complimentary organization cannot be suspended — remove complimentary status first if this is truly intended.');
  }
  await orgRef.set(
    suspended
      ? { status: 'suspended', suspendedReason: reason, suspendedAt: FieldValue.serverTimestamp(), suspendedBy: caller.uid }
      : { status: 'active', suspendedReason: FieldValue.delete(), suspendedAt: FieldValue.delete(), suspendedBy: FieldValue.delete() },
    { merge: true }
  );
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: suspended ? 'org.suspend' : 'org.reactivate', targetType: 'org', targetId: orgId,
    summary: suspended ? `Suspended: ${reason}` : 'Reactivated', createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, status: suspended ? 'suspended' : 'active' };
});

/**
 * Compliance (Phase 13): an org admin accepts the Data Processing Agreement for
 * THEIR OWN org. Records who/when/version on the org doc via the Admin SDK (orgs
 * are client-unwritable). This is the per-org compliance gate surfaced to the
 * platform owner before onboarding an outside tenant.
 */
export const acceptOrgDpa = onCall<{ version: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  const data = callerDoc.exists ? callerDoc.data()! : null;
  const role = data?.role as Role | undefined;
  const orgId = data?.orgId as string | undefined;
  if (!role || !ADMIN_ROLES.includes(role) || !orgId) {
    throw new HttpsError('permission-denied', 'Only an organization admin may accept the agreement.');
  }
  const version = (request.data.version ?? '').trim();
  // Only a server-known version can be recorded, so a client can't stamp a forged
  // or never-presented attestation. Keep in sync with DPA_VERSION in
  // src/lib/compliance.ts (functions can't import from the web src tree).
  const KNOWN_DPA_VERSIONS = ['2026-06-19'];
  if (!KNOWN_DPA_VERSIONS.includes(version)) {
    throw new HttpsError('invalid-argument', 'Unknown agreement version.');
  }
  await db.doc(`orgs/${orgId}`).set(
    {
      dpaAcceptedAt: FieldValue.serverTimestamp(),
      dpaAcceptedBy: caller.uid,
      dpaAcceptedByName: (data?.displayName as string) || '',
      dpaVersion: version,
    },
    { merge: true }
  );
  await db.collection('auditLog').add({
    actorUid: caller.uid,
    action: 'compliance.accept_dpa',
    targetType: 'org',
    targetId: orgId,
    summary: `Accepted Data Processing Agreement ${version}`,
    orgId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * Platform-owner: create an organization's administrator account (the onboarding
 * step after creating the org). Creates a fresh Auth login with an admin role +
 * the target org's claim, ACTIVE, force-password-change, a strong temp password,
 * and emails activation. Role is constrained to the admin roles. Adopts an
 * orphaned Auth login (account exists, no profile) the same way createUserAccount does.
 */
export const createOrgAdmin = onCall<{ orgId: string; email: string; displayName: string; role?: Role }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may create organization administrators.');
  }
  const orgId = (request.data.orgId ?? '').trim();
  const email = (request.data.email ?? '').trim().toLowerCase();
  const displayName = (request.data.displayName ?? '').trim();
  const role: Role = request.data.role && ADMIN_ROLES.includes(request.data.role) ? request.data.role : 'director';
  if (!orgId) throw new HttpsError('invalid-argument', 'Provide an organization.');
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');
  if (!displayName) throw new HttpsError('invalid-argument', 'A display name is required.');
  if (!(await db.doc(`orgs/${orgId}`).get()).exists) throw new HttpsError('not-found', 'That organization does not exist.');

  const password = `Heimdall-${randomBytes(4).toString('hex')}`;
  let uid: string;
  let adopted = false;
  try {
    const created = await getAuth().createUser({ email, password, displayName });
    uid = created.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      const existing = await getAuth().getUserByEmail(email);
      const profileSnap = await db.doc(`users/${existing.uid}`).get();
      if (profileSnap.exists) throw new HttpsError('already-exists', `An account already exists for ${email}.`);
      await getAuth().updateUser(existing.uid, { password, displayName });
      uid = existing.uid;
      adopted = true;
    } else if (code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', `"${email}" is not a valid email address.`);
    } else {
      throw new HttpsError('internal', (err as Error).message || 'Failed to create the account.');
    }
  }

  await getAuth().setCustomUserClaims(uid, { role, orgId });
  await db.doc(`users/${uid}`).set(
    {
      email, displayName, photoURL: '', phone: '', rank: '', agency: '',
      role, orgId, status: 'active', qualifications: [], verifiedQualKeys: [],
      notificationPrefs: { email: true, reminderLeadHours: 48, digest: true },
      mustChangePassword: true,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Activation email (mirrors sendActivationEmail) so the new admin gets credentials.
  const settingsSnap = await db.doc(`settings/${orgId}`).get();
  const orgName = (settingsSnap.data()?.orgName as string) || 'the Training Academy';
  const creds = detailRows([['Sign-in email', email], ['Temporary password', password]]);
  const safeName = escapeHtml(displayName);
  const content = renderEmail({
    subject: `[HEIMDALL] Activate your ${orgName} administrator account`,
    heading: 'Activate your administrator account',
    bodyHtml:
      `Hi ${safeName},<br/><br/>` +
      `An administrator account was created for you on HEIMDALL for ${escapeHtml(orgName)}. ` +
      `Sign in with the temporary password below — you'll choose your own password the first time you log in. ` +
      `As an administrator you can add members, set your organization's join code, and manage your academy.<br/><br/>` +
      creds.html,
    bodyText:
      `Hi ${displayName},\n\n` +
      `An administrator account was created for you on HEIMDALL for ${orgName}. ` +
      `Sign in with the temporary password below — you'll choose your own password the first time you log in.\n\n` +
      `${creds.text}\n\nSign in: ${SITE_URL}`,
    ctaLabel: 'Sign in to activate',
    ctaUrl: SITE_URL,
    orgName,
    logoUrl: settingsSnap.data()?.logoUrl as string | undefined,
  });
  await db.collection('mail').add({
    to: [email],
    message: { subject: content.subject, html: content.html, text: content.text },
    orgId,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'platform.create_org_admin', targetType: 'user', targetId: uid,
    summary: `${adopted ? 'Adopted login as' : 'Created'} ${role} ${displayName} for ${orgId}`, orgId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, uid, tempPassword: password, emailed: true };
});

/**
 * Platform-owner: permanently delete an UNASSIGNED (org-less) account — the
 * "deny → delete" path from the owner queue. Guarded to org-less accounts only;
 * an account that belongs to an org must be removed from it (denyUser) first.
 */
export const deleteUnassignedAccount = onCall<{ uid: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may delete accounts.');
  }
  const uid = (request.data.uid ?? '').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'Missing user.');
  if (uid === caller.uid) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');
  const target = (await db.doc(`users/${uid}`).get()).data();
  if (!target) throw new HttpsError('not-found', 'User not found.');
  if (target.orgId) throw new HttpsError('failed-precondition', 'Only unassigned accounts can be deleted here — remove the account from its organization first.');
  if (target.platformOwner === true) throw new HttpsError('failed-precondition', 'A platform owner account cannot be deleted here.');
  const email = (target.email as string) ?? uid;
  await db.doc(`users/${uid}`).delete();
  await getAuth().deleteUser(uid).catch(() => null);
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'platform.delete_account', targetType: 'user', targetId: uid,
    summary: `Deleted unassigned account ${email}`, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** Platform-owner: brief list of every org (for the nav org-switcher dropdown). */
export const ownerListOrgs = onCall(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may list organizations.');
  }
  const snap = await db.collection('orgs').get();
  const orgs = snap.docs
    .map((o) => ({ orgId: o.id, legalName: (o.data().legalName as string) || o.id }))
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
  return { orgs };
});

/**
 * Platform-owner: switch the owner's ACTIVE organization (to view/fix any tenant).
 * Sets the orgId + role on BOTH the claim and the profile doc together, so the
 * isolation rules and the client agree on the active tenant. The owner's REAL
 * home org + rank are captured once (homeOrgId/homeRole) and restored when
 * switching back, so this is always reversible and never loses his identity. In
 * a non-home org the owner acts as 'director' (full access to fix things);
 * platformOwner is always preserved so he can switch back.
 */
export const ownerSwitchOrg = onCall<{ orgId: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerRef = db.doc(`users/${caller.uid}`);
  const me = (await callerRef.get()).data();
  if (!me || me.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may switch organizations.');
  }
  const target = (request.data.orgId ?? '').trim();
  if (!target) throw new HttpsError('invalid-argument', 'Choose an organization.');
  if (!(await db.doc(`orgs/${target}`).get()).exists) throw new HttpsError('not-found', 'That organization does not exist.');

  const homeOrgId = (me.homeOrgId as string | undefined) ?? (me.orgId as string | undefined);
  const homeRole = (me.homeRole as Role | undefined) ?? (me.role as Role | undefined);
  if (!homeOrgId || !homeRole) {
    throw new HttpsError('failed-precondition', 'Your home organization and rank are not set; cannot switch safely.');
  }
  const goingHome = target === homeOrgId;
  const role: Role = goingHome ? homeRole : 'director';

  const existing = (await getAuth().getUser(caller.uid).catch(() => null))?.customClaims ?? {};
  await getAuth().setCustomUserClaims(caller.uid, { ...existing, orgId: target, role, platformOwner: true });
  await callerRef.set(
    { orgId: target, role, homeOrgId, homeRole, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'platform.switch_org', targetType: 'org', targetId: target,
    summary: goingHome ? `Returned to home org ${target}` : `Switched into org ${target} as ${role}`,
    orgId: target, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, orgId: target, role, goingHome };
});

/**
 * Platform-owner: copy an organization's curricula into the platform DEFAULT
 * templates (defaultCurricula) that every NEW org is seeded from — the
 * "Import from PHSC" action. Strips the source org, normalizes FDLE
 * high-liability flags + ratios, and keys each default by its base key.
 */
export const importDefaultCurricula = onCall<{ sourceOrgId: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may set default curricula.');
  }
  const sourceOrgId = (request.data.sourceOrgId ?? '').trim();
  if (!sourceOrgId) throw new HttpsError('invalid-argument', 'Choose a source organization.');
  const snap = await db.collection('curricula').where('orgId', '==', sourceOrgId).get();
  if (snap.empty) throw new HttpsError('not-found', 'That organization has no curricula to import.');

  const batch = db.batch();
  let count = 0;
  snap.docs.forEach((d) => {
    const data = d.data();
    const baseKey = (data.key as string) || d.id.split('__').pop() || d.id;
    const { orgId: _omitOrg, ...rest } = data;
    batch.set(db.doc(`defaultCurricula/${baseKey}`), {
      ...rest,
      key: baseKey,
      courses: applyFdleHighLiability((data.courses as Record<string, unknown>[]) ?? []),
    });
    count++;
  });
  await batch.commit();
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'platform.import_default_curricula', targetType: 'org', targetId: sourceOrgId,
    summary: `Imported ${count} curricula from ${sourceOrgId} as new-org defaults`, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, count };
});

/** Platform-owner: recent audit entries across ALL organizations (owner oversight). */
export const listAllAuditLog = onCall<{ limit?: number }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  if (!callerDoc.exists || callerDoc.data()!.platformOwner !== true) {
    throw new HttpsError('permission-denied', 'Only the platform owner may view the cross-organization audit log.');
  }
  const lim = Math.min(Math.max(request.data.limit ?? 200, 1), 500);
  const [logSnap, usersSnap, orgsSnap] = await Promise.all([
    db.collection('auditLog').orderBy('createdAt', 'desc').limit(lim).get(),
    db.collection('users').get(),
    db.collection('orgs').get(),
  ]);
  const userName = new Map(usersSnap.docs.map((u) => [u.id, (u.data().displayName as string) || (u.data().email as string) || u.id]));
  const orgName = new Map(orgsSnap.docs.map((o) => [o.id, (o.data().legalName as string) || o.id]));
  const entries = logSnap.docs.map((d) => {
    const a = d.data();
    const orgId = a.orgId as string | undefined;
    return {
      id: d.id,
      action: (a.action as string) ?? '',
      summary: (a.summary as string) ?? '',
      actorName: userName.get(a.actorUid as string) ?? (a.actorUid as string) ?? '',
      targetType: (a.targetType as string) ?? '',
      orgId: orgId ?? null,
      orgName: orgId ? orgName.get(orgId) ?? orgId : null,
      createdAtMs: (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? null,
    };
  });
  return { entries };
});
