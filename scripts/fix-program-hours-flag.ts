/**
 * Repair sessions whose "counts toward program hours" flag was unchecked on
 * real CURRICULUM courses (the pre-Oct-2026 label said "FDLE hours", so staff
 * building non-FDLE programs like New Member Training reasonably unchecked it
 * — which silently removed those sessions from curriculum coverage and the
 * hours tally).
 *
 * Targets ONE academy. Only sessions whose courseId is a curriculum block
 * (`block:...`) are touched — custom/agency blocks and lunches stay excluded
 * by design.
 *
 *   # Report what would change (writes nothing):
 *   npx tsx scripts/fix-program-hours-flag.ts --academy "NMT 2026-4"
 *
 *   # Apply:
 *   npx tsx scripts/fix-program-hours-flag.ts --academy "NMT 2026-4" --fix
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const FIX = process.argv.includes('--fix');
const aFlag = process.argv.indexOf('--academy');
const SHORT = aFlag !== -1 ? process.argv[aFlag + 1] : '';
if (!SHORT) {
  console.error('Usage: npx tsx scripts/fix-program-hours-flag.ts --academy "NMT 2026-4" [--fix]');
  process.exit(1);
}

initializeApp({ credential: cert(sa as never) });
const db = getFirestore();

async function main() {
  const acads = await db.collection('academies').get();
  const matches = acads.docs.filter((d) => (d.data().shortName ?? '') === SHORT && !d.data().isTemplate);
  if (matches.length !== 1) {
    console.error(`Expected exactly one academy with shortName "${SHORT}", found ${matches.length}. Nothing done.`);
    process.exit(1);
  }
  const academy = matches[0];
  console.log(`Academy ${academy.id}: ${academy.data().shortName} — ${academy.data().name}`);

  const sessions = await db.collection('sessions').where('academyId', '==', academy.id).get();
  const toFix = sessions.docs.filter((d) => {
    const s = d.data();
    return (
      typeof s.courseId === 'string' &&
      s.courseId.startsWith('block:') &&
      s.countsTowardFdle === false &&
      s.status !== 'cancelled'
    );
  });
  console.log(`${sessions.size} session(s) total; ${toFix.length} curriculum-block session(s) with the flag unchecked.`);
  for (const d of toFix) {
    const s = d.data();
    console.log(`  - ${s.start?.toDate?.().toLocaleDateString?.() ?? '?'} ${s.courseName} (${s.hours} hrs)`);
  }
  if (!FIX) {
    console.log('\nDry run — re-run with --fix to set countsTowardFdle: true on the sessions above.');
    return;
  }
  let batch = db.batch();
  let n = 0;
  for (const d of toFix) {
    batch.update(d.ref, { countsTowardFdle: true, updatedAt: FieldValue.serverTimestamp() });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`✅ Fixed ${toFix.length} session(s) — they now count toward program hours and curriculum coverage.`);
}

main().then(() => process.exit());
