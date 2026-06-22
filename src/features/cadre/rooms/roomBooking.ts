/**
 * Room-reservation conflict detection. A booking is a non-cancelled session that
 * references a managed room (`roomId`) over a time block; two such sessions
 * conflict when they share a room and their [start,end) intervals overlap.
 * Template academies' sessions are NOT real bookings and are excluded.
 *
 * Custom (free-text) rooms have no roomId and are never conflict-checked — by
 * design they're not reserved entities.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { SessionDoc } from '../../../types';

/** [aStart,aEnd) overlaps [bStart,bEnd). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface RoomConflict {
  session: SessionDoc & { id: string };
  /** Human-readable holder, e.g. "LE 133 — Firearms". */
  label: string;
}

/**
 * Returns the first conflicting booking for `roomId` over [start,end), or null.
 * Reads every session in the org that references this room (typically few), then
 * filters by overlap client-side (Firestore can't range-overlap two fields).
 */
export async function findRoomConflict(opts: {
  orgId: string;
  roomId: string;
  start: Date;
  end: Date;
  excludeSessionId?: string;
  /** True if the session's academy is a template (excluded from conflicts). */
  isTemplate: (academyId: string) => boolean;
  /** Builds the holder label for a conflicting session. */
  labelFor: (s: SessionDoc & { id: string }) => string;
}): Promise<RoomConflict | null> {
  const snap = await getDocs(
    query(collection(db, 'sessions'), where('orgId', '==', opts.orgId), where('roomId', '==', opts.roomId))
  );
  for (const d of snap.docs) {
    if (d.id === opts.excludeSessionId) continue;
    const s = { id: d.id, ...(d.data() as SessionDoc) };
    if (s.status === 'cancelled') continue;
    if (opts.isTemplate(s.academyId)) continue;
    if (overlaps(opts.start, opts.end, s.start.toDate(), s.end.toDate())) {
      return { session: s, label: opts.labelFor(s) };
    }
  }
  return null;
}
