/**
 * Sign-up / withdrawal logic — the careful part (§6 of the spec).
 *
 * signUpForSlot runs a Firestore transaction that:
 *   1. Re-reads the session; confirms the slot exists and has room.
 *   2. Confirms the user holds the required qualification (verified, not
 *      expired) — rejects with a clear error otherwise; offers waitlist when
 *      the slot is full.
 *   3. Adds the uid to roleSlots[].filledBy, writes signups/{uid}, and mirrors
 *      an assignments doc (deterministic id `${sessionId}_${uid}` so the
 *      transaction can address it without a query).
 *   4. Recomputes session.status → 'fully_staffed' when all slots are full.
 *
 * Double-booking is checked against the user's confirmed assignments before
 * the transaction (web SDK transactions cannot run queries). Withdrawal
 * reverses everything and promotes the first waitlisted user if present.
 * Every action appends to auditLog.
 */
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { overlaps } from '../../lib/time';
import type { AssignmentDoc, SessionDoc, SignupDoc, UserDoc } from '../../types';
import { logAudit } from './audit';

export class SignupError extends Error {}

function qualifies(user: UserDoc, requiredKey?: string): boolean {
  if (!requiredKey) return true;
  // verifiedQualKeys is the staff-maintained, rule-protected source of truth;
  // the array entry only supplies expiry metadata.
  if (!(user.verifiedQualKeys ?? []).includes(requiredKey as never)) return false;
  const q = user.qualifications.find((x) => x.key === requiredKey);
  if (!q) return false; // claim removed — stale verifiedQualKeys entry doesn't count
  if (q.expires && q.expires.toMillis() < Date.now()) return false;
  return true;
}

function recomputeStatus(session: SessionDoc): SessionDoc['status'] {
  if (session.status === 'cancelled' || session.status === 'completed' || session.status === 'draft') {
    return session.status;
  }
  const full = session.roleSlots.every((s) => s.filledBy.length >= s.count);
  return full ? 'fully_staffed' : 'open';
}

export interface SignupResult {
  status: 'confirmed' | 'waitlist';
}

export async function signUpForSlot(
  uid: string,
  sessionId: string,
  slotId: string,
  opts: { allowWaitlist?: boolean } = {}
): Promise<SignupResult> {
  // ── Pre-check: double-booking against confirmed assignments ──────────────
  const sessionRefForWindow = doc(db, 'sessions', sessionId);
  const existing = await getDocs(
    query(collection(db, 'assignments'), where('uid', '==', uid), where('status', '==', 'confirmed'))
  );

  const result = await runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRefForWindow);
    if (!sessionSnap.exists()) throw new SignupError('Session no longer exists.');
    const session = sessionSnap.data() as SessionDoc;

    if (session.status === 'cancelled') throw new SignupError('This session has been cancelled.');
    if (session.status === 'draft') throw new SignupError('This session is not yet published.');

    const slot = session.roleSlots.find((s) => s.slotId === slotId);
    if (!slot) throw new SignupError('That role slot no longer exists on this session.');
    if (slot.filledBy.includes(uid)) throw new SignupError('You are already signed up for this slot.');

    // Qualification gate — read the user doc inside the transaction.
    const userSnap = await tx.get(doc(db, 'users', uid));
    if (!userSnap.exists()) throw new SignupError('User profile not found.');
    const user = userSnap.data() as UserDoc;
    if (user.status !== 'active') throw new SignupError('Your account is not active.');
    if (!qualifies(user, slot.requiredQualificationKey)) {
      throw new SignupError(
        `This slot requires a verified "${slot.requiredQualificationKey}" qualification. ` +
          'Request it on your profile and have a coordinator verify it.'
      );
    }

    // Double-booking: any confirmed assignment overlapping this window.
    const start = session.start.toDate();
    const end = session.end.toDate();
    for (const a of existing.docs) {
      const ad = a.data() as AssignmentDoc;
      if (ad.sessionId !== sessionId && overlaps(start, end, ad.start.toDate(), ad.end.toDate())) {
        throw new SignupError(`You are already assigned to "${ad.courseName}" during that time.`);
      }
    }

    const signupRef = doc(db, 'sessions', sessionId, 'signups', uid);
    const now = Timestamp.now();

    // Slot full → waitlist (if the caller opted in).
    if (slot.filledBy.length >= slot.count) {
      if (!opts.allowWaitlist) throw new SignupError('FULL'); // sentinel — UI offers waitlist
      tx.set(signupRef, {
        uid,
        displayName: user.displayName,
        role: slot.role,
        slotId,
        status: 'waitlist',
        signedUpAt: now,
      } satisfies SignupDoc);
      return { status: 'waitlist' as const };
    }

    // Confirmed sign-up: update slot, signup doc, assignment mirror, status.
    const newSlots = session.roleSlots.map((s) =>
      s.slotId === slotId ? { ...s, filledBy: [...s.filledBy, uid] } : s
    );
    const newStatus = recomputeStatus({ ...session, roleSlots: newSlots });

    tx.update(sessionRefForWindow, { roleSlots: newSlots, status: newStatus, updatedAt: now });
    tx.set(signupRef, {
      uid,
      displayName: user.displayName,
      role: slot.role,
      slotId,
      status: 'confirmed',
      signedUpAt: now,
    } satisfies SignupDoc);
    tx.set(doc(db, 'assignments', `${sessionId}_${uid}`), {
      uid,
      sessionId,
      academyId: session.academyId,
      role: slot.role,
      courseName: session.courseName,
      location: session.location,
      room: session.room,
      start: session.start,
      end: session.end,
      status: 'confirmed',
      reminderSent: false,
      createdAt: now,
    } satisfies AssignmentDoc);

    return { status: 'confirmed' as const };
  });

  await logAudit(uid, 'signup.create', 'session', sessionId, `Signed up (${result.status}) for slot ${slotId}`);
  return result;
}

export async function withdrawFromSession(uid: string, sessionId: string): Promise<void> {
  // Find a waitlisted candidate for promotion before the transaction
  // (transactions can't query). Validated again inside the transaction.
  const waitlistSnap = await getDocs(
    query(
      collection(db, 'sessions', sessionId, 'signups'),
      where('status', '==', 'waitlist'),
      orderBy('signedUpAt'),
    )
  );

  await runTransaction(db, async (tx) => {
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new SignupError('Session no longer exists.');
    const session = sessionSnap.data() as SessionDoc;

    const signupRef = doc(db, 'sessions', sessionId, 'signups', uid);
    const signupSnap = await tx.get(signupRef);
    if (!signupSnap.exists()) throw new SignupError('No sign-up found to withdraw.');
    const signup = signupSnap.data() as SignupDoc;
    const now = Timestamp.now();

    // Remove from the slot.
    let newSlots = session.roleSlots.map((s) =>
      s.slotId === signup.slotId ? { ...s, filledBy: s.filledBy.filter((u) => u !== uid) } : s
    );

    tx.update(signupRef, { status: 'withdrawn' });
    tx.update(doc(db, 'assignments', `${sessionId}_${uid}`), { status: 'withdrawn' });

    // Promote the first waitlisted user for the same slot, if any.
    const candidate = waitlistSnap.docs
      .map((d) => d.data() as SignupDoc)
      .find((w) => w.slotId === signup.slotId && w.uid !== uid);
    if (candidate) {
      newSlots = newSlots.map((s) =>
        s.slotId === signup.slotId ? { ...s, filledBy: [...s.filledBy, candidate.uid] } : s
      );
      tx.update(doc(db, 'sessions', sessionId, 'signups', candidate.uid), { status: 'confirmed' });
      tx.set(doc(db, 'assignments', `${sessionId}_${candidate.uid}`), {
        uid: candidate.uid,
        sessionId,
        academyId: session.academyId,
        role: candidate.role,
        courseName: session.courseName,
        location: session.location,
        room: session.room,
        start: session.start,
        end: session.end,
        status: 'confirmed',
        reminderSent: false,
        createdAt: now,
      } satisfies AssignmentDoc);
    }

    const newStatus = recomputeStatus({ ...session, roleSlots: newSlots });
    tx.update(sessionRef, { roleSlots: newSlots, status: newStatus, updatedAt: now });
  });

  await logAudit(uid, 'signup.withdraw', 'session', sessionId, 'Withdrew from session');
}
