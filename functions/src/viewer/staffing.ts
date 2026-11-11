/**
 * getViewerStaffing — the ONLY data source for a read-only Viewer account.
 *
 * A Viewer has no direct database access (firestore.rules: isViewer). This
 * callable reads what the staffing page needs with the Admin SDK and returns
 * names, roles, counts and schedule facts ONLY. Member and cadet records hold
 * phone numbers, birth dates, ID numbers and calendar-feed links; none of that
 * is ever copied into the response (every field below is picked explicitly).
 * Session notes are left out too: staff can type anything into them.
 *
 * Who may call: an active Viewer of the org, or the platform owner (to preview
 * exactly what the Viewer sees). Scope: the caller's own org.
 *
 * Sign-in log: each Viewer sign-in is recorded in auditLog the first time that
 * sign-in loads data. The sign-in moment is the ID token's `auth_time`, which
 * Google signs into the token — the client cannot fake or skip it. One entry
 * per sign-in (doc id = uid + auth_time); later loads bump lastAccessAt /
 * accessCount. If the log cannot be written, no data is returned.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { VIEWER_ROLE } from './guard';
import { addDays, daysBetween, localDate, localDay, localMidnightMs, localStamp, localTime, validDate } from './time';

/** Default and maximum span of the date window, in days. */
export const VIEWER_DEFAULT_DAYS = 60;
export const VIEWER_MAX_DAYS = 180;

type StaffingState = 'cancelled' | 'fully_staffed' | 'understaffed' | 'not_open';

export interface ViewerSlot {
  role: string;
  requiredQualification: string | null;
  needed: number;
  filled: { name: string; awaitingConfirmation: boolean }[];
  open: number;
  waitlist: number;
}
export interface ViewerSession {
  id: string;
  academyId: string;
  academy: string;
  date: string;
  day: string;
  start: string;
  end: string;
  course: string;
  room: string;
  location: string;
  hours: number;
  status: string;
  test: boolean;
  staffing: StaffingState;
  openSeats: number;
  slots: ViewerSlot[];
  writeIns: { name: string; role: string }[];
}
export interface ViewerAcademy {
  id: string;
  name: string;
  shortName: string;
  program: string;
  status: string;
  startDate: string;
  endDate: string;
  coordinators: string[];
  cadets: { enrolled: number; blockTakers: number; graduated: number; separated: number };
  sessionsInRange: number;
  openSeatsInRange: number;
}
export interface ViewerStaffing {
  orgName: string;
  generatedAt: string;
  range: { from: string; to: string };
  academies: ViewerAcademy[];
  sessions: ViewerSession[];
  totals: { sessions: number; understaffed: number; fullyStaffed: number; notOpen: number; cancelled: number; openSeats: number };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export const getViewerStaffing = onCall<{ from?: string; to?: string; academyId?: string }>(
  { timeoutSeconds: 60 },
  async (request): Promise<ViewerStaffing> => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const db = getFirestore();

    // ── Who is asking ──────────────────────────────────────────────────────
    const me = (await db.doc(`users/${auth.uid}`).get()).data();
    const owner = me?.platformOwner === true;
    // Both the signed token and the profile must say Viewer.
    const viewer = me?.role === VIEWER_ROLE && auth.token.role === VIEWER_ROLE;
    if (!me || (!viewer && !owner)) throw new HttpsError('permission-denied', 'This page is only for Viewer accounts.');
    if (me.status !== 'active') throw new HttpsError('permission-denied', 'This account is not active.');
    const orgId = str(me.orgId);
    if (!orgId) throw new HttpsError('failed-precondition', 'This account is not linked to an organization.');
    if (viewer && auth.token.orgId !== orgId) throw new HttpsError('permission-denied', 'Sign out and sign in again.');
    const org = (await db.doc(`orgs/${orgId}`).get()).data();
    if (viewer && org?.status === 'suspended') throw new HttpsError('permission-denied', 'This organization is suspended.');

    // ── Date window (org-local calendar days) ─────────────────────────────
    const today = localDate(Date.now());
    const from = request.data?.from == null || request.data.from === '' ? today : validDate(request.data.from);
    if (!from) throw new HttpsError('invalid-argument', 'Start date must be a date (yyyy-mm-dd).');
    const to = request.data?.to == null || request.data.to === '' ? addDays(from, VIEWER_DEFAULT_DAYS) : validDate(request.data.to);
    if (!to) throw new HttpsError('invalid-argument', 'End date must be a date (yyyy-mm-dd).');
    if (to < from) throw new HttpsError('invalid-argument', 'End date is before the start date.');
    if (daysBetween(from, to) > VIEWER_MAX_DAYS) {
      throw new HttpsError('invalid-argument', `Pick a range of ${VIEWER_MAX_DAYS} days or fewer.`);
    }
    const startMs = localMidnightMs(from);
    const endMs = localMidnightMs(addDays(to, 1));
    const academyFilter = str(request.data?.academyId);

    // ── Sign-in log (Viewer only; before any data leaves) ─────────────────
    if (viewer) {
      const authTime = Number(auth.token.auth_time);
      if (!Number.isFinite(authTime) || authTime <= 0) throw new HttpsError('unauthenticated', 'Sign in again.');
      const signedInMs = authTime * 1000;
      const raw = request.rawRequest as { ip?: string; headers?: Record<string, unknown> } | undefined;
      const ip = str(raw?.ip).slice(0, 64) || 'unknown IP';
      const userAgent = str(raw?.headers?.['user-agent']).slice(0, 300);
      const name = str(me.displayName) || 'Viewer';
      const ref = db.doc(`auditLog/viewer_signin_${auth.uid}_${authTime}`);
      const now = Date.now();
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? num(snap.data()?.accessCount) + 1 : 1;
        const summary =
          `${name} (Viewer) signed in ${localStamp(signedInMs)} from ${ip}. ` +
          `Last used ${localStamp(now)} · ${count} page load${count === 1 ? '' : 's'}.`;
        if (!snap.exists) {
          tx.create(ref, {
            actorUid: auth.uid, action: 'viewer.sign_in', targetType: 'user', targetId: auth.uid, orgId,
            summary, ip, userAgent,
            signedInAt: Timestamp.fromMillis(signedInMs),
            // createdAt = the sign-in moment, so the audit log lists it in order.
            createdAt: Timestamp.fromMillis(signedInMs),
            lastAccessAt: Timestamp.fromMillis(now),
            accessCount: 1,
          });
        } else {
          tx.update(ref, { summary, lastAccessAt: Timestamp.fromMillis(now), accessCount: FieldValue.increment(1) });
        }
      });
    }

    // ── Academies (no templates, no archived classes) ─────────────────────
    const acadSnap = await db.collection('academies').where('orgId', '==', orgId).get();
    let academyDocs = acadSnap.docs.filter((d) => d.data().isTemplate !== true && d.data().status !== 'archived');
    if (academyFilter) {
      academyDocs = academyDocs.filter((d) => d.id === academyFilter);
      if (!academyDocs.length) throw new HttpsError('not-found', 'That class is not available.');
    }
    const academyById = new Map(academyDocs.map((d) => [d.id, d.data()]));

    // ── Sessions in the window ────────────────────────────────────────────
    const sessSnap = await db
      .collection('sessions')
      .where('orgId', '==', orgId)
      .where('start', '>=', Timestamp.fromMillis(startMs))
      .where('start', '<', Timestamp.fromMillis(endMs))
      .orderBy('start')
      .get();
    const sessionDocs = sessSnap.docs.filter((d) => {
      const s = d.data();
      return academyById.has(str(s.academyId)) && s.kind !== 'lunch' && ms(s.start) != null && ms(s.end) != null;
    });

    // Sign-ups: names, pending reservations and waitlists (no extra PII).
    const signupsBySession = new Map<string, DocumentData[]>();
    await inChunks(sessionDocs, 25, async (d) => {
      if (d.data().status === 'cancelled') return;
      const snap = await d.ref.collection('signups').get();
      signupsBySession.set(d.id, snap.docs.map((x) => ({ ...x.data(), uid: x.id })));
    });

    // Names for anyone not covered by a sign-up doc (legacy slot holders,
    // coordinators). Only displayName is read out of each profile.
    const names = new Map<string, string>();
    for (const list of signupsBySession.values()) for (const su of list) if (str(su.displayName)) names.set(su.uid, str(su.displayName));
    const wanted = new Set<string>();
    for (const d of sessionDocs) {
      for (const slot of (d.data().roleSlots ?? []) as DocumentData[]) {
        for (const uid of (slot.filledBy ?? []) as unknown[]) if (typeof uid === 'string' && !names.has(uid)) wanted.add(uid);
      }
    }
    for (const a of academyById.values()) for (const uid of (a.coordinatorIds ?? []) as unknown[]) if (typeof uid === 'string' && !names.has(uid)) wanted.add(uid);
    const wantedRefs = [...wanted].filter((u) => /^[A-Za-z0-9_-]{1,128}$/.test(u)).map((u) => db.doc(`users/${u}`));
    for (let i = 0; i < wantedRefs.length; i += 100) {
      const snaps = await db.getAll(...wantedRefs.slice(i, i + 100));
      for (const s of snaps) if (s.exists && s.data()?.orgId === orgId) names.set(s.id, str(s.data()?.displayName) || 'Unnamed member');
    }
    const nameOf = (uid: string) => names.get(uid) ?? 'Former member';

    // ── Shape sessions ────────────────────────────────────────────────────
    const sessions: ViewerSession[] = sessionDocs.map((d) => {
      const s = d.data();
      const startAt = ms(s.start)!;
      const endAt = ms(s.end)!;
      const signups = signupsBySession.get(d.id) ?? [];
      const pending = new Set(signups.filter((x) => x.status === 'confirmed' && x.reservationState === 'pending').map((x) => x.uid));
      const cancelled = s.status === 'cancelled';
      const slots: ViewerSlot[] = ((s.roleSlots ?? []) as DocumentData[]).map((slot) => {
        const filledBy = ((slot.filledBy ?? []) as unknown[]).filter((u): u is string => typeof u === 'string');
        const needed = Math.max(0, num(slot.count));
        return {
          role: str(slot.role),
          requiredQualification: str(slot.requiredQualificationKey) || null,
          needed,
          filled: filledBy.map((uid) => ({ name: nameOf(uid), awaitingConfirmation: pending.has(uid) })),
          open: cancelled ? 0 : Math.max(0, needed - filledBy.length),
          waitlist: signups.filter((x) => x.status === 'waitlist' && x.slotId === slot.slotId).length,
        };
      });
      const openSeats = slots.reduce((n, sl) => n + sl.open, 0);
      const staffing: StaffingState = cancelled
        ? 'cancelled'
        : openSeats === 0
          ? 'fully_staffed'
          : s.status === 'draft' || s.status === 'scheduled'
            ? 'not_open'
            : 'understaffed';
      const academy = academyById.get(str(s.academyId))!;
      return {
        id: d.id,
        academyId: str(s.academyId),
        academy: str(academy.shortName) || str(academy.name),
        date: localDate(startAt),
        day: localDay(startAt),
        start: localTime(startAt),
        end: localTime(endAt),
        course: str(s.title) || str(s.courseName),
        room: str(s.room),
        location: str(s.location),
        hours: num(s.hours),
        status: str(s.status),
        test: s.includesTest === true,
        staffing,
        openSeats,
        slots,
        writeIns: ((s.writeInInstructors ?? []) as DocumentData[])
          .filter((w) => str(w.name))
          .map((w) => ({ name: str(w.name), role: str(w.role) })),
      };
    });

    // ── Academies with cadet COUNTS (never cadet records) ─────────────────
    const academies: ViewerAcademy[] = await inChunks([...academyById.entries()], 10, async ([id, a]) => {
      const roster = db.collection(`academies/${id}/roster`);
      const [active, blockTakers, graduated, separated] = await Promise.all([
        roster.where('status', '==', 'active').count().get(),
        roster.where('status', '==', 'active').where('blockTaker', '==', true).count().get(),
        roster.where('status', '==', 'graduated').count().get(),
        roster.where('status', 'in', ['withdrawn', 'dismissed']).count().get(),
      ]);
      const mine = sessions.filter((s) => s.academyId === id);
      const startAt = ms(a.startDate);
      const endAt = ms(a.endDate);
      return {
        id,
        name: str(a.name),
        shortName: str(a.shortName),
        program: str(a.fdleProgram) || str(a.discipline),
        status: str(a.status),
        startDate: startAt == null ? '' : localDate(startAt),
        endDate: endAt == null ? '' : localDate(endAt),
        coordinators: ((a.coordinatorIds ?? []) as unknown[]).filter((u): u is string => typeof u === 'string').map(nameOf),
        cadets: {
          enrolled: Math.max(0, active.data().count - blockTakers.data().count),
          blockTakers: blockTakers.data().count,
          graduated: graduated.data().count,
          separated: separated.data().count,
        },
        sessionsInRange: mine.length,
        openSeatsInRange: mine.reduce((n, s) => n + s.openSeats, 0),
      };
    });
    academies.sort((x, y) => x.startDate.localeCompare(y.startDate) || x.name.localeCompare(y.name));

    const settings = (await db.doc(`settings/${orgId}`).get()).data();
    const live = sessions.filter((s) => s.staffing !== 'cancelled');
    return {
      orgName: str(settings?.orgName) || str(org?.legalName) || orgId,
      generatedAt: localStamp(Date.now()),
      range: { from, to },
      academies,
      sessions,
      totals: {
        sessions: live.length,
        understaffed: live.filter((s) => s.staffing === 'understaffed').length,
        fullyStaffed: live.filter((s) => s.staffing === 'fully_staffed').length,
        notOpen: live.filter((s) => s.staffing === 'not_open').length,
        cancelled: sessions.length - live.length,
        openSeats: live.reduce((n, s) => n + s.openSeats, 0),
      },
    };
  }
);
