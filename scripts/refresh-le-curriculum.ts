/**
 * Refresh an existing org's curriculum to the verified built-in FDLE course list.
 *
 * Org curricula (curricula/{orgId}__{key}) are seeded ONCE at org-creation from
 * the platform defaults and are NOT auto-updated when the built-in defaults
 * change. So after correcting src/features/admin/fdleCurricula.ts, run this to
 * push the corrected course list + total hours into a live org's curriculum,
 * PRESERVING that org's other customizations (label, roster modules, branding,
 * report categories, per-course staffing slots).
 *
 *   # Dry run — prints the before/after, writes nothing:
 *   npx tsx scripts/refresh-le-curriculum.ts phsc
 *
 *   # Apply (default key is le_brt):
 *   npx tsx scripts/refresh-le-curriculum.ts phsc --commit
 *   npx tsx scripts/refresh-le-curriculum.ts phsc co_brt --commit
 *
 * Owner: also click "Load FDLE standard curricula" on the Default Curricula page
 * so every NEW org seeds from the corrected set.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';
import { FDLE_DEFAULT_CURRICULA } from '../src/features/admin/fdleCurricula';

const orgId = process.argv[2];
const key = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'le_brt';
const COMMIT = process.argv.includes('--commit');

if (!orgId) {
  console.error('Usage: npx tsx scripts/refresh-le-curriculum.ts <orgId> [key=le_brt] [--commit]');
  process.exit(1);
}

const template = FDLE_DEFAULT_CURRICULA.find((c) => c.key === key);
if (!template || template.courses.length === 0) {
  console.error(`No populated default curriculum with key "${key}" (shells have no courses).`);
  process.exit(1);
}

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

async function main() {
  const docId = `curricula/${orgId}__${key}`;
  const ref = db.doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`${docId} does not exist — seed it via org setup or create it in Curriculum & Hours first.`);
    process.exit(1);
  }
  const current = snap.data() as { courses?: unknown[]; totalHours?: number; estimated?: boolean };
  console.log(docId);
  console.log(`  current: ${(current.courses ?? []).length} courses, total ${current.totalHours ?? '?'} hrs, estimated=${current.estimated}`);
  console.log(`  new:     ${template!.courses.length} courses, total ${template!.totalHours} hrs, estimated=false`);

  if (!COMMIT) {
    console.log('\nDry run — re-run with --commit to apply. Only courses + totalHours + estimated change; all other fields are preserved.');
    return;
  }
  await ref.update({
    courses: template!.courses,
    totalHours: template!.totalHours,
    estimated: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log('\nApplied. Org customizations (label, roster modules, branding, categories) preserved.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
