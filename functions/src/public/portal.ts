/**
 * Public class portal — the ONLY unauthenticated read surface in HEIMDALL.
 * Firestore rules stay fully closed; this callable (Admin SDK) validates the
 * link token + tier password server-side and returns SANITIZED data:
 *
 *   tier 'schedule'  — gate: the digits of the class designation ("LE 132" →
 *                      "132"). Returns the cadet-schedule data (no cover/meta):
 *                      day blocks, rooms, lead instructor names. PSO/internal
 *                      pay blocks are excluded, exactly like the cadet printout.
 *   tier 'academic'  — gate: the coordinator-set password (stored only as a
 *                      SHA-256 hash on the academy doc). Adds the roster's
 *                      grades + violations and the tested-course list so the
 *                      client renders the read-only gradebook. Discipline
 *                      output includes ONLY cadets who have entries.
 *
 * No PII beyond names/grades ever leaves: no contact info, no DOB, no CJIS,
 * no student IDs, no emergency contacts.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import type { AcademyDoc, UserDoc } from '../types';

const PSO_BLOCK = 'PSO Assignment'; // internal pay-filler — never public

type PortalRequest = {
  academyId: string;
  token: string;
  /** Tier-1 access code (digits of the class designation). */
  code: string;
  tier: 'schedule' | 'academic';
  academicPassword?: string;
};

export const getPublicClassPortal = onCall<PortalRequest>(async (request) => {
  const db = getFirestore();
  const { academyId, token, code, tier, academicPassword } = request.data ?? ({} as PortalRequest);
  if (!academyId || !token) throw new HttpsError('invalid-argument', 'This class link is not valid.');

  const snap = await db.doc(`academies/${academyId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'This class link is not available.');
  const a = snap.data() as AcademyDoc;
  if (!a.portal?.enabled || a.portal.token !== token || a.isTemplate) {
    throw new HttpsError('permission-denied', 'This class link is not available.');
  }

  // Tier 1: the digits of the class designation ("LE 132" → "132").
  const expected = (a.shortName ?? '').replace(/\D+/g, '');
  if (!expected) throw new HttpsError('failed-precondition', 'This class link is not available.');
  if (((code ?? '') as string).replace(/\D+/g, '') !== expected) {
    throw new HttpsError('permission-denied', 'Incorrect access code.');
  }

  if (tier === 'academic') {
    if (!a.portal.academicHash) {
      throw new HttpsError('failed-precondition', 'Academic information is not enabled for this class.');
    }
    const hash = createHash('sha256').update(academicPassword ?? '', 'utf8').digest('hex');
    if (hash !== a.portal.academicHash) throw new HttpsError('permission-denied', 'Incorrect academic password.');

    const rosterSnap = await db.collection(`academies/${academyId}/roster`).get();
    const members = rosterSnap.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      const violations = ((m.violations as Record<string, unknown>[] | undefined) ?? []).map((v) => ({
        dateMs: (v.date as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
        type: v.type === 'Other' ? ((v.typeOther as string) || 'Other') : (v.type as string),
        level: v.level as string,
      }));
      return {
        id: d.id,
        fullName: (m.fullName as string) ?? '',
        status: (m.status as string) ?? 'active',
        no: (m.no as number) ?? 0,
        blockTaker: !!m.blockTaker,
        grades: (m.grades as Record<string, unknown>) ?? {},
        withdrawnAfterCourse: (m.withdrawnAfterCourse as string) ?? null,
        violations,
      };
    });

    // Curriculum: platform doc first (base key), else the org's own copy.
    const disc = a.discipline ?? '';
    const base = disc.includes('__') ? disc.slice(disc.indexOf('__') + 2) : disc;
    let cur = await db.doc(`defaultCurricula/${base}`).get();
    if (!cur.exists && disc) cur = await db.doc(`curricula/${disc}`).get();
    const courses = cur.exists
      ? (((cur.data()!.courses ?? []) as Record<string, unknown>[]).map((c) => ({
          name: c.name as string,
          cjk: (c.cjk as string) ?? null,
          minHours: (c.minHours as number) ?? 0,
          highLiability: !!c.highLiability,
          tested: !!c.tested,
        })))
      : [];

    return { kind: 'academic', className: a.shortName || a.name, members, courses };
  }

  // Tier 'schedule' — the cadet schedule, sanitized.
  const sess = await db.collection('sessions').where('academyId', '==', academyId).get();
  const visible = sess.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((s) => s.status !== 'cancelled' && s.status !== 'draft' && (s.courseName as string) !== PSO_BLOCK);

  const leadUids = new Set<string>();
  for (const s of visible) {
    for (const sl of (s.roleSlots as Record<string, unknown>[] | undefined) ?? []) {
      if (sl.role === 'lead') for (const u of (sl.filledBy as string[] | undefined) ?? []) leadUids.add(u);
    }
  }
  const refs = [...leadUids].map((u) => db.doc(`users/${u}`));
  const userSnaps = refs.length ? await db.getAll(...refs) : [];
  const nameByUid = new Map(userSnaps.filter((u) => u.exists).map((u) => [u.id, (u.data() as UserDoc).displayName]));

  const sessions = visible
    .map((s) => {
      const start = s.start as { toMillis: () => number };
      const end = s.end as { toMillis: () => number };
      const leads = [
        ...(((s.roleSlots as Record<string, unknown>[] | undefined) ?? [])
          .filter((sl) => sl.role === 'lead')
          .flatMap((sl) => (sl.filledBy as string[] | undefined) ?? [])
          .map((u) => nameByUid.get(u))
          .filter(Boolean) as string[]),
        ...(((s.writeInInstructors as { name: string; role: string }[] | undefined) ?? [])
          .filter((w) => w.role === 'lead')
          .map((w) => w.name)),
      ];
      return {
        title: (s.title as string) || (s.courseName as string) || '',
        startMs: start?.toMillis?.() ?? 0,
        endMs: end?.toMillis?.() ?? 0,
        room: (s.room as string) ?? '',
        hours: (s.hours as number) ?? 0,
        highLiability: !!s.highLiability,
        notes: (s.notes as string) ?? '',
        kind: (s.kind as string) ?? null,
        leadNames: leads,
      };
    })
    .filter((s) => s.startMs > 0)
    .sort((x, y) => x.startMs - y.startMs);

  return {
    kind: 'schedule',
    className: a.shortName || a.name,
    name: a.name,
    program: a.fdleProgram ?? '',
    startMs: a.startDate?.toMillis?.() ?? null,
    endMs: a.endDate?.toMillis?.() ?? null,
    academicAvailable: !!a.portal.academicHash,
    sessions,
  };
});
