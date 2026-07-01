/**
 * Server-owned ad-hoc room reservations (audit item 2). The conflict check + the
 * write run inside an Admin-SDK transaction, so two concurrent reservations can't
 * race past a client-side check and double-book a room — and the rules forbid
 * client writes to roomReservations, so the check can't be bypassed. A reservation
 * conflicts with any non-cancelled, non-template session on the same room OR any
 * other reservation on that room over an overlapping interval.
 *
 * (Session room writes remain client-guarded — fully server-owning the core
 * session create/edit path is disproportionate for a low-severity staff-vs-staff
 * race; see the audit notes.)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Role } from '../types';
import { STAFF_ROLES } from '../types';

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

export const saveRoomReservation = onCall<{
  reservationId?: string;
  roomId: string;
  title: string;
  startMs: number;
  endMs: number;
  notes?: string;
}>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();

  const callerSnap = await db.doc(`users/${uid}`).get();
  const callerRole = callerSnap.exists ? (callerSnap.data()!.role as Role) : null;
  if (!callerRole || !STAFF_ROLES.includes(callerRole)) throw new HttpsError('permission-denied', 'Staff only.');
  if (callerSnap.data()?.status === 'suspended' || callerSnap.data()?.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }

  const reservationId = request.data.reservationId?.trim();
  const roomId = (request.data.roomId ?? '').trim();
  const title = (request.data.title ?? '').trim();
  const notes = (request.data.notes ?? '').trim();
  const { startMs, endMs } = request.data;
  if (!roomId || !title) throw new HttpsError('invalid-argument', 'Room and title are required.');
  if (!(typeof startMs === 'number' && typeof endMs === 'number' && endMs > startMs)) {
    throw new HttpsError('invalid-argument', 'End time must be after the start time.');
  }

  const roomSnap = await db.doc(`rooms/${roomId}`).get();
  if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found.');
  const orgId = roomSnap.data()!.orgId as string | undefined;
  const callerOrg = callerSnap.data()?.orgId as string | undefined;
  const isOwner = callerSnap.data()?.platformOwner === true;
  if (!orgId) throw new HttpsError('failed-precondition', 'That room is missing its organization.');
  if (!isOwner && orgId !== callerOrg) throw new HttpsError('permission-denied', 'That room belongs to another organization.');

  const start = Timestamp.fromMillis(startMs);
  const end = Timestamp.fromMillis(endMs);
  const startD = start.toDate();
  const endD = end.toDate();

  // Template-academy sessions aren't real bookings — pre-read their ids.
  const templSnap = await db.collection('academies').where('orgId', '==', orgId).where('isTemplate', '==', true).get();
  const templateIds = new Set(templSnap.docs.map((d) => d.id));

  const id = reservationId || db.collection('roomReservations').doc().id;
  await db.runTransaction(async (tx) => {
    // Reads first (Admin SDK transaction requirement). A session can hold this
    // room as its primary (roomId) OR one of several rooms (roomIds, e.g. a
    // scenario day) — check both. The array-contains query needs no orgId filter
    // since room ids are globally unique (one room → one org).
    const sessByPrimary = await tx.get(db.collection('sessions').where('orgId', '==', orgId).where('roomId', '==', roomId));
    const sessByArray = await tx.get(db.collection('sessions').where('orgId', '==', orgId).where('roomIds', 'array-contains', roomId));
    const res = await tx.get(db.collection('roomReservations').where('orgId', '==', orgId).where('roomId', '==', roomId));
    const roomName = (roomSnap.data()!.name as string) || 'That room';

    const seenSess = new Set<string>();
    for (const d of [...sessByPrimary.docs, ...sessByArray.docs]) {
      if (seenSess.has(d.id)) continue;
      seenSess.add(d.id);
      const s = d.data();
      if (s.status === 'cancelled' || templateIds.has(s.academyId)) continue;
      if (overlaps(startD, endD, s.start.toDate(), s.end.toDate())) {
        throw new HttpsError('failed-precondition', `${roomName} is already booked by a class (${s.title || s.courseName}) during that time.`);
      }
    }
    for (const d of res.docs) {
      if (d.id === id) continue;
      const r = d.data();
      if (overlaps(startD, endD, r.start.toDate(), r.end.toDate())) {
        throw new HttpsError('failed-precondition', `${roomName} already has a reservation (${r.title}) during that time.`);
      }
    }

    const ref = db.doc(`roomReservations/${id}`);
    if (reservationId) {
      tx.update(ref, { roomId, title, start, end, notes: notes || FieldValue.delete() });
    } else {
      tx.set(ref, { orgId, roomId, title, start, end, ...(notes ? { notes } : {}), createdBy: uid, createdAt: FieldValue.serverTimestamp() });
    }
  });

  return { id };
});

export const deleteRoomReservation = onCall<{ reservationId: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const callerSnap = await db.doc(`users/${uid}`).get();
  const callerRole = callerSnap.exists ? (callerSnap.data()!.role as Role) : null;
  if (!callerRole || !STAFF_ROLES.includes(callerRole)) throw new HttpsError('permission-denied', 'Staff only.');
  if (callerSnap.data()?.status === 'suspended' || callerSnap.data()?.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
  const reservationId = (request.data.reservationId ?? '').trim();
  if (!reservationId) throw new HttpsError('invalid-argument', 'Missing reservation.');
  const snap = await db.doc(`roomReservations/${reservationId}`).get();
  if (!snap.exists) return { ok: true };
  const orgId = snap.data()!.orgId as string | undefined;
  const isOwner = callerSnap.data()?.platformOwner === true;
  if (!isOwner && orgId !== (callerSnap.data()?.orgId as string | undefined)) {
    throw new HttpsError('permission-denied', 'That reservation belongs to another organization.');
  }
  await db.doc(`roomReservations/${reservationId}`).delete();
  return { ok: true };
});
