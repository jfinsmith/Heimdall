/**
 * Admin callables — role/claim management.
 *
 * setUserRole writes the role to users/{uid} AND mirrors it into a custom
 * auth claim so firestore.rules can check `request.auth.token.role` without
 * an extra read. Only directors/lieutenants (per the RBAC matrix) may call it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { notify } from '../gjallarhorn/notify';
import type { AcademyDoc, Role } from '../types';
import { ADMIN_ROLES, STAFF_ROLES } from '../types';

const VALID_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator', 'instructor'];

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

  await getAuth().setCustomUserClaims(uid, { role });
  await getFirestore().doc(`users/${uid}`).set({ role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  await getFirestore().collection('auditLog').add({
    actorUid: caller.uid,
    action: 'admin.set_role',
    targetType: 'user',
    targetId: uid,
    summary: `Role set to ${role}`,
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

  const email = (request.data.email ?? '').trim().toLowerCase();
  const displayName = (request.data.displayName ?? '').trim();
  const { role } = request.data;
  const password = (request.data.password ?? '').trim() || DEFAULT_TEMP_PASSWORD;
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');
  if (!displayName) throw new HttpsError('invalid-argument', 'A display name is required.');
  if (!VALID_ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Pick a valid role.');
  if (password.length < 6) throw new HttpsError('invalid-argument', 'Temporary password must be at least 6 characters.');

  let uid: string;
  try {
    const created = await getAuth().createUser({ email, password, displayName });
    uid = created.uid;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') throw new HttpsError('already-exists', `An account already exists for ${email}.`);
    if (code === 'auth/invalid-email') throw new HttpsError('invalid-argument', `"${email}" is not a valid email address.`);
    if (code === 'auth/invalid-password') throw new HttpsError('invalid-argument', 'Temporary password must be at least 6 characters.');
    throw new HttpsError('internal', (err as Error).message || 'Failed to create the account.');
  }

  await getAuth().setCustomUserClaims(uid, { role });
  await getFirestore().doc(`users/${uid}`).set({
    email,
    displayName,
    photoURL: '',
    phone: (request.data.phone ?? '').trim(),
    rank: (request.data.rank ?? '').trim(),
    agency: (request.data.agency ?? '').trim(),
    role,
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
    summary: `Created ${displayName} (${role})`,
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
  const directors = await dbRef.collection('users').where('role', '==', 'director').limit(1).get();
  if (!directors.empty) throw new HttpsError('failed-precondition', 'A director already exists.');

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

  // The single active user holding a command role (there is exactly one each).
  async function single(role: Role): Promise<{ uid: string; name: string }> {
    const q = await db.collection('users').where('role', '==', role).where('status', '==', 'active').get();
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
