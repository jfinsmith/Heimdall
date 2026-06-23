/**
 * Find (and optionally repair) sessions with a non-positive duration — end at or
 * before start, or a missing start/end. These are the bad docs that previously
 * crashed the calendar (FullCalendar renders a null `end` for them). The app now
 * tolerates them at render time and blocks creating new ones; this script reports
 * the ones already in the database so they can be corrected.
 *
 *   # Report only (default — writes nothing):
 *   npx tsx scripts/find-bad-duration-sessions.ts
 *
 *   # Repair: set end = start + (hours * 60min) for each bad session that has a
 *   # positive `hours` field. Sessions with no usable hours are reported, not touched.
 *   npx tsx scripts/find-bad-duration-sessions.ts --fix
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const FIX = process.argv.includes('--fix');

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

interface SessionLike {
  start?: Timestamp;
  end?: Timestamp;
  hours?: number;
  lunchMinutes?: number;
  lunchCountsTowardHours?: boolean;
  courseName?: string;
  academyId?: string;
  orgId?: string;
  kind?: string;
}

/**
 * Reconstruct the intended clock span (hours). The stored `hours` field excludes
 * the lunch carve-out (hours = span - lunch unless lunch counts), so add it back
 * to land on the original end time.
 */
function spanHours(s: SessionLike): number {
  const hours = typeof s.hours === 'number' ? s.hours : 0;
  const lunchHrs = s.lunchCountsTowardHours ? 0 : (s.lunchMinutes ?? 0) / 60;
  return hours + lunchHrs;
}

function describe(id: string, s: SessionLike): string {
  const start = s.start ? s.start.toDate().toISOString() : '(missing)';
  const end = s.end ? s.end.toDate().toISOString() : '(missing)';
  return `${id}  org=${s.orgId ?? '?'}  academy=${s.academyId ?? '?'}  "${s.courseName ?? ''}"${s.kind ? ` [${s.kind}]` : ''}  start=${start}  end=${end}  hours=${s.hours ?? '?'}`;
}

async function main() {
  const snap = await db.collection('sessions').get();
  const bad: { id: string; s: SessionLike }[] = [];
  for (const doc of snap.docs) {
    const s = doc.data() as SessionLike;
    const startMs = s.start?.toMillis();
    const endMs = s.end?.toMillis();
    if (typeof startMs !== 'number' || typeof endMs !== 'number' || endMs <= startMs) {
      bad.push({ id: doc.id, s });
    }
  }

  console.log(`Scanned ${snap.size} sessions — ${bad.length} with a bad/zero/negative duration:\n`);
  if (bad.length === 0) {
    console.log('None. Nothing to fix.');
    return;
  }
  for (const { id, s } of bad) console.log('  ' + describe(id, s));

  if (!FIX) {
    console.log('\nReport only. Re-run with --fix to repair sessions that have a positive `hours` value');
    console.log('(end = start + hours). Sessions without usable hours/start must be fixed by hand in the editor.');
    return;
  }

  console.log('\n--fix: repairing where possible…\n');
  let fixed = 0;
  let skipped = 0;
  for (const { id, s } of bad) {
    const span = spanHours(s);
    if (!s.start || span <= 0) {
      console.log(`  SKIP ${id} — no usable start/hours to recompute an end. Fix manually.`);
      skipped++;
      continue;
    }
    const newEnd = Timestamp.fromMillis(s.start.toMillis() + span * 60 * 60 * 1000);
    await db.doc(`sessions/${id}`).update({ end: newEnd, updatedAt: FieldValue.serverTimestamp() });
    console.log(`  FIXED ${id} — end set to ${newEnd.toDate().toISOString()} (start + ${span}h span)`);
    fixed++;
  }
  console.log(`\nDone. Fixed ${fixed}, skipped ${skipped}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
