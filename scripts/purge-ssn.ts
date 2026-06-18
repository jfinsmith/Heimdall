/**
 * One-time PURGE of all stored cadet SSN data. HEIMDALL no longer collects or
 * stores SSNs (the college keeps them in its own system of record); this removes
 * the `ssnCipher` + `ssnLast4` fields from every existing roster member across
 * all academies. DRY-RUN BY DEFAULT — pass --execute to write.
 *
 *   Prereqs: service-account.json in the repo root (gitignored).
 *
 *   Usage:
 *     npx tsx scripts/purge-ssn.ts              # dry run (reports only)
 *     npx tsx scripts/purge-ssn.ts --execute    # delete ssnCipher / ssnLast4
 *
 *   After this, you may also delete the now-unused secret:
 *     firebase functions:secrets:destroy ROSTER_SSN_KEY
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const EXECUTE = process.argv.includes('--execute');
const DO = EXECUTE ? '' : '[dry-run] would ';

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

async function main() {
  const academies = await db.collection('academies').get();
  let touched = 0;
  let scanned = 0;
  for (const a of academies.docs) {
    const roster = await a.ref.collection('roster').get();
    const dirty = roster.docs.filter((d) => 'ssnCipher' in d.data() || 'ssnLast4' in d.data());
    scanned += roster.size;
    if (dirty.length === 0) continue;
    console.log(`  ${DO}strip SSN from ${dirty.length}/${roster.size} members in academies/${a.id}`);
    touched += dirty.length;
    if (EXECUTE) {
      for (let i = 0; i < dirty.length; i += 400) {
        const batch = db.batch();
        for (const d of dirty.slice(i, i + 400)) {
          batch.set(
            d.ref,
            { ssnCipher: FieldValue.delete(), ssnLast4: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        await batch.commit();
      }
    }
  }
  console.log(`\n${DO}purge SSN from ${touched} of ${scanned} roster members across ${academies.size} academies.`);
  if (!EXECUTE) console.log('Re-run with --execute to apply.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
