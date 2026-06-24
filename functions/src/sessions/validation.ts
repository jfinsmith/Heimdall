/**
 * Shared sign-up / staffing validators — the single source of truth for "may this
 * person fill this slot?" so self-sign-up (signup.ts), waitlist auto-promotion
 * (gjallarhorn/triggers.ts), and coordinator reserve all enforce the SAME gates:
 * qualification, FDLE instructor-cert currency, and cross-session double-booking.
 */
import type { Transaction } from 'firebase-admin/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { AssignmentDoc, RoleSlot, SessionDoc, UserDoc } from '../types';

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;
export const isInstructorQual = (key?: string) => !!key && key !== 'role_player';

export function qualifies(user: UserDoc, requiredKey?: string): boolean {
  if (!requiredKey) return true;
  if (!(user.verifiedQualKeys ?? []).includes(requiredKey as UserDoc['verifiedQualKeys'][number])) return false;
  return (user.qualifications ?? []).some((q) => q.key === requiredKey);
}

export function certBlocks(user: UserDoc & { instructorCertExpires?: Timestamp }, requiredKey?: string): boolean {
  if (!isInstructorQual(requiredKey)) return false;
  const exp = user.instructorCertExpires;
  return !(exp && exp.toDate() >= new Date());
}

export function recomputeStatus(status: SessionDoc['status'], slots: RoleSlot[]): SessionDoc['status'] {
  if (status !== 'open' && status !== 'fully_staffed') return status;
  return slots.every((s) => s.filledBy.length >= s.count) ? 'fully_staffed' : 'open';
}

/**
 * Why `uid` may NOT fill `slot` on `session` — missing qualification, expired
 * instructor cert, or a double-booking against a confirmed assignment in another
 * session. Returns null when eligible. Queries `assignments` INSIDE the
 * transaction (Admin SDK only). Does NOT check capacity / one-slot-per-session —
 * callers enforce those. The returned reason is pronoun-neutral so callers can
 * frame it ("You are…" vs "They are…").
 */
export async function fillConflictReason(
  tx: Transaction,
  args: {
    uid: string;
    user: UserDoc & { instructorCertExpires?: Timestamp };
    slot: RoleSlot;
    session: SessionDoc;
    sessionId: string;
    orgId: string;
  }
): Promise<string | null> {
  const { uid, user, slot, session, sessionId, orgId } = args;
  if (!qualifies(user, slot.requiredQualificationKey)) {
    return `missing the required "${slot.requiredQualificationKey}" qualification`;
  }
  if (certBlocks(user, slot.requiredQualificationKey)) {
    return 'FDLE instructor certification has expired or is not on file';
  }
  const db = getFirestore();
  const start = session.start.toDate();
  const end = session.end.toDate();
  const existing = await tx.get(
    db.collection('assignments').where('uid', '==', uid).where('status', '==', 'confirmed').where('orgId', '==', orgId)
  );
  for (const a of existing.docs) {
    const ad = a.data() as AssignmentDoc;
    if (ad.sessionId !== sessionId && overlaps(start, end, ad.start.toDate(), ad.end.toDate())) {
      return `already assigned to "${ad.courseName}" during that time`;
    }
  }
  return null;
}
