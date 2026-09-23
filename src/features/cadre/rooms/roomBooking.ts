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

/**
 * True when an academy's sessions should NOT count as room bookings at all:
 * templates never really book, and ARCHIVED classes are abandoned schedules
 * that must not keep blocking rooms forever.
 *
 * DRAFTS are a third tier — SOFT holds: they conflict, but with a
 * warn-and-schedule-anyway instead of a hard block. Rooms belong to whichever
 * class PUBLISHES first, not whichever draft grabbed them first; the builder's
 * room-conflict banner keeps every unresolved overlap visible on both sides
 * until someone moves. (See draftHolderAcademy + findRoomConflict's soft path.)
 */
export function roomExemptAcademy(a?: { isTemplate?: boolean; status?: string } | null): boolean {
  return !!a && (a.isTemplate === true || a.status === 'archived');
}

/** True when the holding academy is a non-template DRAFT — a soft room hold. */
export function draftHolderAcademy(a?: { isTemplate?: boolean; status?: string } | null): boolean {
  return !!a && a.isTemplate !== true && a.status === 'draft';
}

/**
 * Conflict-holder label. shortName alone turns ambiguous the moment a copy
 * exists (two "LE 133"s) — exactly when the label matters most — so the full
 * name rides along, and non-running classes get their status appended:
 * "LE 133 · OCT START (COPY) (draft) — Introduction to Law Enforcement".
 */
export function academyHolderLabel(a?: { shortName?: string; name?: string; status?: string } | null): string {
  if (!a) return 'another class';
  const base = [a.shortName, a.name].filter(Boolean).join(' · ') || 'another class';
  return a.status === 'published' || a.status === 'in_progress' ? base : `${base} (${a.status ?? 'unknown'})`;
}

/**
 * All sessions that reference `roomId` (any status — caller filters), as either
 * the primary room (`roomId`) OR one of several reserved rooms (`roomIds`, e.g. a
 * scenario day). Two queries merged + de-duped. BOTH filter `orgId` — the sessions
 * list rule (`inOrg(resource.data)`) requires it, and the array-contains one is
 * backed by the orgId+roomIds composite index in firestore.indexes.json.
 */
export async function loadRoomBookings(orgId: string, roomId: string): Promise<(SessionDoc & { id: string })[]> {
  const [byPrimary, byArray] = await Promise.all([
    getDocs(query(collection(db, 'sessions'), where('orgId', '==', orgId), where('roomId', '==', roomId))),
    getDocs(query(collection(db, 'sessions'), where('orgId', '==', orgId), where('roomIds', 'array-contains', roomId))),
  ]);
  const map = new Map<string, SessionDoc & { id: string }>();
  for (const d of [...byPrimary.docs, ...byArray.docs]) map.set(d.id, { id: d.id, ...(d.data() as SessionDoc) });
  return [...map.values()];
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
  /** True = the hold is SOFT (a draft class, or everything when the saving
   *  academy is itself a draft) — warn + allow "schedule anyway" instead of a
   *  hard block. A hard conflict is always returned in preference to a soft
   *  one, so a confirmed soft conflict can't mask a hard one. */
  soft: boolean;
}

/**
 * Returns the first conflicting hold (session OR reservation) for `roomId` over
 * [start,end), or null. Used by every room-booking save path. Hard conflicts
 * (published classes, reservations) block; soft ones (see RoomConflict.soft)
 * are the caller's warn-and-proceed.
 */
export async function findRoomConflict(opts: {
  orgId: string;
  roomId: string;
  start: Date;
  end: Date;
  excludeSessionId?: string;
  excludeReservationId?: string;
  /** True to skip this academy's sessions (template/archived — see roomExemptAcademy). */
  ignoreAcademy: (academyId: string) => boolean;
  /** Classifies a holding session as a SOFT conflict (draft academies under
   *  first-publish-wins). Omit = every conflict is hard. */
  softSession?: (s: SessionDoc & { id: string }) => boolean;
  /** True = ad-hoc reservations are soft too (the SAVING academy is a draft). */
  softReservations?: boolean;
  /** Builds the holder label for a conflicting session. */
  labelFor: (s: SessionDoc & { id: string }) => string;
}): Promise<RoomConflict | null> {
  let firstSoft: RoomConflict | null = null;
  for (const s of await loadRoomBookings(opts.orgId, opts.roomId)) {
    if (s.id === opts.excludeSessionId) continue;
    if (s.status === 'cancelled') continue;
    if (opts.ignoreAcademy(s.academyId)) continue;
    if (overlaps(opts.start, opts.end, s.start.toDate(), s.end.toDate())) {
      const c = { label: opts.labelFor(s), start: s.start.toDate(), end: s.end.toDate(), soft: opts.softSession?.(s) === true };
      if (!c.soft) return c;
      firstSoft ??= c;
    }
  }
  for (const r of await loadRoomReservations(opts.orgId, opts.roomId)) {
    if (r.id === opts.excludeReservationId) continue;
    if (overlaps(opts.start, opts.end, r.start.toDate(), r.end.toDate())) {
      const c = { label: `🔒 ${r.title || 'Reservation'}`, start: r.start.toDate(), end: r.end.toDate(), soft: opts.softReservations === true };
      if (!c.soft) return c;
      firstSoft ??= c;
    }
  }
  return firstSoft;
}
