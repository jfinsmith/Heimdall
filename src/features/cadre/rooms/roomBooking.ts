/**
 * Room-reservation conflict detection. A room is "booked" over a time block by
 * either (a) a non-cancelled session that references it (`roomId`), or (b) an
 * ad-hoc room reservation. Two holds conflict when their [start,end) intervals
 * overlap. Template academies' sessions are NOT real bookings and are excluded.
 *
 * Custom (free-text) rooms have no roomId and are never conflict-checked.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { RoomReservationDoc, SessionDoc } from '../../../types';

/** [aStart,aEnd) overlaps [bStart,bEnd). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** All sessions in the org that reference `roomId` (any status — caller filters). */
export async function loadRoomBookings(orgId: string, roomId: string): Promise<(SessionDoc & { id: string })[]> {
  const snap = await getDocs(
    query(collection(db, 'sessions'), where('orgId', '==', orgId), where('roomId', '==', roomId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) }));
}

/** All ad-hoc reservations in the org for `roomId`. */
export async function loadRoomReservations(orgId: string, roomId: string): Promise<(RoomReservationDoc & { id: string })[]> {
  const snap = await getDocs(
    query(collection(db, 'roomReservations'), where('orgId', '==', orgId), where('roomId', '==', roomId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoomReservationDoc) }));
}

export interface RoomConflict {
  /** Human-readable holder, e.g. "LE 133 — Firearms" or "🔒 Maintenance". */
  label: string;
  start: Date;
  end: Date;
}

/**
 * Returns the first conflicting hold (session OR reservation) for `roomId` over
 * [start,end), or null. Used by every room-booking save path so a managed room
 * can't be double-booked.
 */
export async function findRoomConflict(opts: {
  orgId: string;
  roomId: string;
  start: Date;
  end: Date;
  excludeSessionId?: string;
  excludeReservationId?: string;
  /** True if the session's academy is a template (excluded from conflicts). */
  isTemplate: (academyId: string) => boolean;
  /** Builds the holder label for a conflicting session. */
  labelFor: (s: SessionDoc & { id: string }) => string;
}): Promise<RoomConflict | null> {
  for (const s of await loadRoomBookings(opts.orgId, opts.roomId)) {
    if (s.id === opts.excludeSessionId) continue;
    if (s.status === 'cancelled') continue;
    if (opts.isTemplate(s.academyId)) continue;
    if (overlaps(opts.start, opts.end, s.start.toDate(), s.end.toDate())) {
      return { label: opts.labelFor(s), start: s.start.toDate(), end: s.end.toDate() };
    }
  }
  for (const r of await loadRoomReservations(opts.orgId, opts.roomId)) {
    if (r.id === opts.excludeReservationId) continue;
    if (overlaps(opts.start, opts.end, r.start.toDate(), r.end.toDate())) {
      return { label: `🔒 ${r.title || 'Reservation'}`, start: r.start.toDate(), end: r.end.toDate() };
    }
  }
  return null;
}
