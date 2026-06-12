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
  // Guard: nobody demotes the last director by accident — directors can only
  // be changed by another director.
  const targetDoc = await getFirestore().doc(`users/${uid}`).get();
  if (targetDoc.exists && targetDoc.data()!.role === 'director' && callerRole !== 'director') {
    throw new HttpsError('permission-denied', 'Only a director may change a director’s role.');
  }

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
