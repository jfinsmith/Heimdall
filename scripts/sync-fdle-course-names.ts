/**
 * Sync FDLE course NAMES across prod, keyed by CJK number (the stable id that
 * never changes). For every curriculum whose course cjk matches the canonical
 * table but whose NAME drifted, this renames:
 *   1. the curriculum docs themselves (defaultCurricula + every org's curricula),
 *   2. every SESSION of already-created academies (courseName + courseId),
 *   3. academy per-course default-room keys (courseRoomDefaults).
 * Grades and withdrawal markers are ALREADY keyed by CJK (courseKey) and need
 * no migration; filed reports keep their historical wording on purpose.
 *
 * Hours are NEVER synced — crossover programs legitimately reuse a CJK with
 * fewer hours. Names only.
 *
 *   npx tsx scripts/sync-fdle-course-names.ts          # report only
 *   npx tsx scripts/sync-fdle-course-names.ts --fix    # apply
 *
 * Re-runnable and idempotent — for FUTURE renames, update the canonical names
 * in src/features/admin/fdleCurricula.ts AND this table, then run again.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const FIX = process.argv.includes('--fix');
initializeApp({ credential: cert(sa as never) });
const db = getFirestore();

/** Canonical FDLE titles (2026-09 naming conventions), keyed by CJK. */
const CANON: Record<string, string> = {
  // Law Enforcement BRT
  CJK0002: 'Introduction to Law Enforcement',
  CJK0016: 'Communication',
  CJK0018: 'Legal',
  CJK0019: 'Interviewing and Report Writing',
  CJK0063: 'Fundamentals of Patrol',
  CJK0021: 'Serving Your Community',
  CJK0072: 'Crimes Against Persons',
  CJK0073: 'Crimes Involving Property and Society',
  CJK0079: 'Crime Scene Follow-up Investigations',
  CJK0400: 'Traffic Incidents',
  CJK0401: 'Traffic Stops',
  CJK0402: 'Traffic Crash Investigations',
  CJK0403: 'DUI Traffic Stops',
  CJK0093: 'Critical Incidents',
  CJK0020: 'Law Enforcement Vehicle Operations',
  CJK0031: 'First Aid for Criminal Justice Officers',
  CJK0040: 'Criminal Justice Firearms',
  CJK0051: 'Criminal Justice Defensive Tactics',
  CJK0421: 'Conducted Electrical Weapon/Dart-Firing Stun Gun',
  CJK0096: 'Criminal Justice Officer Physical Fitness Training (Law Enforcement)',
  // Corrections BRT
  CJK0301: 'Introduction to Corrections',
  CJK0355: 'Legal for Correctional Officers',
  CJK0306: 'Communications for Correctional Officers',
  CJK0111: 'Interviewing and Report Writing in Corrections',
  CJK0327: 'Shift Management and Safety',
  CJK0321: 'Intake and Release',
  CJK0324: 'Supervision in a Correctional Facility',
  CJK0326: 'Supervising Correctional Populations',
  CJK0336: 'Incidents and Emergencies in Correctional Facilities',
  CJK0340: 'Criminal Justice Officer Physical Fitness Training (Corrections)',
};
const normCjk = (v: string | undefined) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

async function main() {
  // Pass 1 — curriculum docs: rename drifted courses; collect old→new for pass 2.
  const renames = new Map<string, string>(); // old course name → canonical name
  for (const coll of ['defaultCurricula', 'curricula']) {
    const snap = await db.collection(coll).get();
    for (const d of snap.docs) {
      const courses = (d.data().courses ?? []) as { cjk?: string; name: string }[];
      let changed = false;
      const next = courses.map((c) => {
        const canon = CANON[normCjk(c.cjk)];
        if (canon && c.name !== canon) {
          console.log(`${coll}/${d.id}: "${c.name}" → "${canon}"`);
          renames.set(c.name, canon);
          changed = true;
          return { ...c, name: canon };
        }
        return c;
      });
      if (changed && FIX) await d.ref.update({ courses: next, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  if (renames.size === 0) {
    console.log('All curriculum course names already match the canonical table. Nothing to do.');
    return;
  }

  // Pass 2 — sessions on every already-created academy.
  let sessionCount = 0;
  for (const [oldName, newName] of renames) {
    const snap = await db.collection('sessions').where('courseName', '==', oldName).get();
    for (const d of snap.docs) {
      sessionCount++;
      if (FIX) {
        const patch: Record<string, unknown> = { courseName: newName, updatedAt: FieldValue.serverTimestamp() };
        if (d.data().courseId === `block:${oldName}`) patch.courseId = `block:${newName}`;
        await d.ref.update(patch);
      }
    }
    console.log(`sessions "${oldName}": ${snap.size} to rename`);
  }

  // Pass 3 — academy per-course default-room keys.
  let acadCount = 0;
  const academies = await db.collection('academies').get();
  for (const d of academies.docs) {
    const defaults = d.data().courseRoomDefaults as Record<string, unknown> | undefined;
    if (!defaults) continue;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(defaults)) {
      const nk = renames.get(k) ?? k;
      if (nk !== k) changed = true;
      next[nk] = v;
    }
    if (changed) {
      acadCount++;
      console.log(`academies/${d.id}: courseRoomDefaults keys renamed`);
      if (FIX) await d.ref.update({ courseRoomDefaults: next, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  console.log(
    `\n${renames.size} course name(s) drifted; ${sessionCount} session(s), ${acadCount} academy room-default map(s). ` +
      (FIX ? 'APPLIED.' : 'Report only — run with --fix to apply.')
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
