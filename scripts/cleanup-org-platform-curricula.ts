/**
 * Delete an org's leftover COPIES of the five platform FDLE curricula.
 *
 * Those programs now live ONCE in `defaultCurricula` and are read read-only across
 * every org (resolution in src/lib/curricula.ts), so any per-org copy
 * (curricula/{orgId}__{key}, or a legacy bare curricula/{key}) is stale and
 * already ignored by the app — this removes them so they don't linger. The org's
 * OWN curricula (custom keys) are never touched. Dry-run by default.
 *
 *   npx tsx scripts/cleanup-org-platform-curricula.ts phsc          # preview
 *   npx tsx scripts/cleanup-org-platform-curricula.ts phsc --commit # delete
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const PLATFORM_KEYS = ['le_brt', 'co_brt', 'co_to_le', 'le_to_co', 'eot'];
const orgId = process.argv[2];
const COMMIT = process.argv.includes('--commit');

if (!orgId) {
  console.error('Usage: npx tsx scripts/cleanup-org-platform-curricula.ts <orgId> [--commit]');
  process.exit(1);
}

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

async function main() {
  const targets: string[] = [];
  for (const key of PLATFORM_KEYS) {
    const ns = db.doc(`curricula/${orgId}__${key}`);
    if ((await ns.get()).exists) targets.push(ns.path);
    // Legacy bare id — only if it actually belongs to this org.
    const bare = db.doc(`curricula/${key}`);
    const bareSnap = await bare.get();
    if (bareSnap.exists && (bareSnap.data() as { orgId?: string }).orgId === orgId) targets.push(bare.path);
  }

  if (targets.length === 0) {
    console.log(`No leftover platform-curriculum copies for ${orgId}. Nothing to clean.`);
    return;
  }
  console.log(`${targets.length} stale platform-curriculum copy(ies) for ${orgId}:`);
  targets.forEach((p) => console.log('  ' + p));

  if (!COMMIT) {
    console.log('\nDry run — re-run with --commit to delete. (The app already ignores these; this is housekeeping.)');
    return;
  }
  for (const p of targets) await db.doc(p).delete();
  console.log(`\nDeleted ${targets.length}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
