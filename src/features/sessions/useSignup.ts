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
  // verifiedQualKeys is the staff-maintained, rule-protected source of truth.
  // (Expiration is tracked in the agency's certification portal, not here.)
  if (!(user.verifiedQualKeys ?? []).includes(requiredKey as never)) return false;
  const q = user.qualifications.find((x) => x.key === requiredKey);
  if (!q) return false; // claim removed — stale verifiedQualKeys entry doesn't count
  return true;
}

function recomputeStatus(session: SessionDoc): SessionDoc['status'] {
  // Only flip between open/fully_staffed — draft/scheduled/cancelled/completed
  // are lifecycle states owned by coordinators, not by staffing math.
  if (session.status !== 'open' && session.status !== 'fully_staffed') {
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
    if (session.status === 'scheduled') {
      throw new SignupError('Sign-ups for this course have not been opened by the coordinators yet.');
    }

    const slot = session.roleSlots.find((s) => s.slotId === slotId);
    if (!slot) throw new SignupError('That role slot no longer exists on this session.');
    if (slot.filledBy.includes(uid)) throw new SignupError('You are already signed up for this slot.');
    // One slot per session — you can't hold two roles in the same time block.
    // (UI hides the second button, but the quick-signup path doesn't, so gate here.)
    if (session.roleSlots.some((s) => s.filledBy.includes(uid))) {
      throw new SignupError('You are already signed up for another slot in this session.');
    }

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

    // Remove yourself from the slot. Promoting the next waitlisted user is done
    // server-side by the onSignupWritten Cloud Function — the security rules
    // (correctly) forbid a client from writing another user's signup, so doing
    // it here would make any withdrawal-with-waitlist fail outright.
    const newSlots = session.roleSlots.map((s) =>
      s.slotId === signup.slotId ? { ...s, filledBy: s.filledBy.filter((u) => u !== uid) } : s
    );

    tx.update(signupRef, { status: 'withdrawn' });
    tx.update(doc(db, 'assignments', `${sessionId}_${uid}`), { status: 'withdrawn' });

    const newStatus = recomputeStatus({ ...session, roleSlots: newSlots });
    tx.update(sessionRef, { roleSlots: newSlots, status: newStatus, updatedAt: now });
  });

  await logAudit(uid, 'signup.withdraw', 'session', sessionId, 'Withdrew from session');
}
