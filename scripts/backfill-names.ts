/**
 * Backfill firstName/lastName for accounts that predate the split-name fields
 * (Aug 2026): the last displayName token becomes lastName (generational
 * suffixes Jr./Sr./II–V stay attached), everything before it firstName.
 * DOB is NOT backfilled — members supply it themselves at the one-time
 * /complete-profile gate on their next sign-in.
 *
 *   # Report only (default — writes nothing): review every proposed split
 *   npx tsx scripts/backfill-names.ts
 *
 *   # Apply the splits:
 *   npx tsx scripts/backfill-names.ts --fix
 *
 * Odd names (rank prefixes, single-word names) are flagged in the report —
 * correct those by hand afterward via Admin → Users & Roles → Edit.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const FIX = process.argv.includes('--fix');

initializeApp({ credential: cert(sa as never) });
const db = getFirestore();

function splitDisplayName(name: string): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  let lastIdx = parts.length - 1;
  if (/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[lastIdx]) && parts.length >= 3) lastIdx -= 1;
  return { firstName: parts.slice(0, lastIdx).join(' '), lastName: parts.slice(lastIdx).join(' ') };
}

async function main() {
  const snap = await db.collection('users').get();
  let fixed = 0;
  let flagged = 0;
  for (const d of snap.docs) {
    const u = d.data() as { displayName?: string; firstName?: string; lastName?: string; dob?: string };
    if (u.firstName && u.lastName) continue; // already split
    const { firstName, lastName } = splitDisplayName(u.displayName ?? '');
    const odd = !lastName || /\./.test(firstName) || firstName.split(' ').length > 2;
    if (odd) flagged++;
    console.log(
      `${odd ? '⚠ ' : '  '}${d.id}  "${u.displayName}"  →  first="${firstName}" last="${lastName}"` +
      `${u.dob ? '' : '  (no DOB — will be prompted at sign-in)'}`
    );
    if (FIX) {
      await d.ref.update({ firstName, lastName, updatedAt: FieldValue.serverTimestamp() });
      fixed++;
    }
  }
  console.log(`\n${snap.size} users scanned; ${FIX ? `${fixed} updated` : 'no writes (report only — run with --fix)'}; ${flagged} flagged for manual review (fix odd splits via Admin → Users & Roles → Edit).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
