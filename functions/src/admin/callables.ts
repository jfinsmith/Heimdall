/**
 * Admin callables — role/claim management.
 *
 * setUserRole writes the role to users/{uid} AND mirrors it into a custom
 * auth claim so firestore.rules can check `request.auth.token.role` without
 * an extra read. Only directors/lieutenants (per the RBAC matrix) may call it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Role } from '../types';
import { ADMIN_ROLES } from '../types';

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
