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
import { notify } from '../gjallarhorn/notify';
import { renderEmail, detailRows, escapeHtml } from '../gjallarhorn/templates';
import type { AcademyDoc, Role } from '../types';
import { ADMIN_ROLES, STAFF_ROLES } from '../types';

/** Production sign-in URL used in account emails. */
const SITE_URL = 'https://heimdall.tgcmd-portal.com';

const VALID_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator', 'instructor', 'guest'];

export const setUserRole = onCall<{ uid: string; role: Role }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');

  // Authorize from the caller's Firestore profile (claims may lag on first use).
  const callerDoc = await getFirestore().doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may assign roles.');
  }

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
export const createOrg = onCall<{ shortCode: string; legalName: string; firstAdminUid?: string }>(async (request) => {
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
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });
      return true;
    });
    if (ok) orgId = candidate;
  }
  if (!orgId) throw new HttpsError('internal', 'Could not allocate a unique org id; please retry.');

  // Optionally seat the first admin, preserving their other claims.
  const firstAdminUid = (request.data.firstAdminUid ?? '').trim();
  if (firstAdminUid) {
    const adminUser = await getAuth().getUser(firstAdminUid).catch(() => null);
    if (!adminUser) throw new HttpsError('not-found', 'firstAdminUid does not match an existing account.');
    const existing = adminUser.customClaims ?? {};
    await getAuth().setCustomUserClaims(firstAdminUid, { ...existing, role: 'director', orgId });
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
export const setUserSuspension = onCall<{ uid: string; suspended: boolean; reason?: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerDoc = await db.doc(`users/${caller.uid}`).get();
  const callerRole = callerDoc.exists ? (callerDoc.data()!.role as Role) : null;
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only directors and lieutenants may suspend members.');
  }

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
  action: 'submit' | 'approve' | 'request_changes';
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
  const callerUid = caller.uid;

  const { academyId, action, note } = request.data;
  if (!academyId) throw new HttpsError('invalid-argument', 'Missing academy.');
  const ref = db.doc(`academies/${academyId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Academy not found.');
  const academy = snap.data() as AcademyDoc;
  if (academy.isTemplate) throw new HttpsError('failed-precondition', 'Templates do not go through approval.');

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
