/**
 * Server-owned sign-up / withdrawal (audit hardening). Moving these off the
 * client closes the integrity gap where a non-staff client could bypass the app
 * and hand-edit `session.roleSlots` directly (over-fill a slot, insert other
 * uids, fill a slot they're unqualified for) — rules can't constrain array
 * contents. With these callables as the only non-staff writer, the security
 * rules forbid client roleSlots writes entirely.
 *
 * The caller signs up ONLY themselves (uid = request.auth.uid). All validation
 * (publish state, qualification, instructor-cert currency, capacity, one-slot,
 * double-booking) runs inside an Admin-SDK transaction — which, unlike the web
 * SDK, may run the double-booking QUERY inside the transaction.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { AssignmentDoc, SessionDoc, SignupDoc, UserDoc } from '../types';
import { overlaps, qualifies, certBlocks, recomputeStatus } from './validation';

export const submitSignup = onCall<{ sessionId: string; slotId: string; allowWaitlist?: boolean }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const sessionId = (request.data.sessionId ?? '').trim();
  const slotId = (request.data.slotId ?? '').trim();
  const allowWaitlist = !!request.data.allowWaitlist;
  if (!sessionId || !slotId) throw new HttpsError('invalid-argument', 'Missing session or slot.');

  const status = await db.runTransaction(async (tx) => {
    const sessionRef = db.doc(`sessions/${sessionId}`);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session no longer exists.');
    const session = sessionSnap.data() as SessionDoc;
    const sOrg = session.orgId ?? null;
    if (!sOrg) throw new HttpsError('failed-precondition', 'This session is missing its organization.');
    if (session.status === 'cancelled') throw new HttpsError('failed-precondition', 'This session has been cancelled.');
    if (session.status === 'draft') throw new HttpsError('failed-precondition', 'This session is not yet published.');
    if ((session.status as string) === 'scheduled') throw new HttpsError('failed-precondition', 'Sign-ups for this course have not been opened yet.');

    const userSnap = await tx.get(db.doc(`users/${uid}`));
    if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
    const user = userSnap.data() as UserDoc & { instructorCertExpires?: Timestamp };
    if (user.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
    if (user.role === 'guest') throw new HttpsError('permission-denied', 'Guests cannot sign up for sessions.');
    if ((user.orgId ?? null) !== sOrg) throw new HttpsError('permission-denied', 'This session belongs to another organization.');

    const slot = session.roleSlots.find((s) => s.slotId === slotId);
    if (!slot) throw new HttpsError('failed-precondition', 'That role slot no longer exists.');
    if (slot.filledBy.includes(uid)) throw new HttpsError('failed-precondition', 'You are already signed up for this slot.');
    if (session.roleSlots.some((s) => s.filledBy.includes(uid))) {
      throw new HttpsError('failed-precondition', 'You are already signed up for another slot in this session.');
    }
    if (!qualifies(user, slot.requiredQualificationKey)) {
      throw new HttpsError('failed-precondition', `This slot requires a verified "${slot.requiredQualificationKey}" qualification.`);
    }
    if (certBlocks(user, slot.requiredQualificationKey)) {
      throw new HttpsError('failed-precondition', 'Your FDLE instructor certification has expired or is not on file.');
    }

    // Double-booking — query inside the transaction (Admin SDK supports this).
    const start = session.start.toDate();
    const end = session.end.toDate();
    const existing = await tx.get(
      db.collection('assignments').where('uid', '==', uid).where('status', '==', 'confirmed').where('orgId', '==', sOrg)
    );
    for (const a of existing.docs) {
      const ad = a.data() as AssignmentDoc;
      if (ad.sessionId !== sessionId && overlaps(start, end, ad.start.toDate(), ad.end.toDate())) {
        throw new HttpsError('failed-precondition', `You are already assigned to "${ad.courseName}" during that time.`);
      }
    }

    const now = Timestamp.now();
    const signupRef = db.doc(`sessions/${sessionId}/signups/${uid}`);
    const base = { uid, orgId: sOrg, displayName: user.displayName ?? '', role: slot.role, slotId, signedUpAt: now };

    if (slot.filledBy.length >= slot.count) {
      if (!allowWaitlist) throw new HttpsError('failed-precondition', 'FULL');
      tx.set(signupRef, { ...base, status: 'waitlist' } satisfies SignupDoc);
      return 'waitlist' as const;
    }

    const newSlots = session.roleSlots.map((s) => (s.slotId === slotId ? { ...s, filledBy: [...s.filledBy, uid] } : s));
    tx.update(sessionRef, { roleSlots: newSlots, status: recomputeStatus(session.status, newSlots), updatedAt: now });
    tx.set(signupRef, { ...base, status: 'confirmed' } satisfies SignupDoc);
    tx.set(db.doc(`assignments/${sessionId}_${uid}`), {
      uid, orgId: sOrg, sessionId, academyId: session.academyId, role: slot.role,
      courseName: session.courseName ?? '', location: session.location ?? '', room: session.room ?? '',
      start: session.start, end: session.end, status: 'confirmed', reminderSent: false, createdAt: now,
    } satisfies AssignmentDoc);
    return 'confirmed' as const;
  });

  await db.collection('auditLog').add({
    actorUid: uid, action: 'signup.create', targetType: 'session', targetId: sessionId,
    summary: `Signed up (${status}) for slot ${slotId}`, createdAt: FieldValue.serverTimestamp(),
  });
  return { status };
});

export const withdrawSignup = onCall<{ sessionId: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const sessionId = (request.data.sessionId ?? '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'Missing session.');

  await db.runTransaction(async (tx) => {
    const sessionRef = db.doc(`sessions/${sessionId}`);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session no longer exists.');
    const session = sessionSnap.data() as SessionDoc;

    const signupRef = db.doc(`sessions/${sessionId}/signups/${uid}`);
    const signupSnap = await tx.get(signupRef);
    if (!signupSnap.exists) throw new HttpsError('failed-precondition', 'No sign-up found to withdraw.');
    const signup = signupSnap.data() as SignupDoc;
    const assignmentRef = db.doc(`assignments/${sessionId}_${uid}`);
    const assignmentSnap = await tx.get(assignmentRef);
    const now = Timestamp.now();

    const newSlots = session.roleSlots.map((s) =>
      s.slotId === signup.slotId ? { ...s, filledBy: s.filledBy.filter((u) => u !== uid) } : s
    );
    tx.update(signupRef, { status: 'withdrawn' });
    if (assignmentSnap.exists) tx.update(assignmentRef, { status: 'withdrawn' });
    tx.update(sessionRef, { roleSlots: newSlots, status: recomputeStatus(session.status, newSlots), updatedAt: now });
  });

  await db.collection('auditLog').add({
    actorUid: uid, action: 'signup.withdraw', targetType: 'session', targetId: sessionId,
    summary: 'Withdrew from session', createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
