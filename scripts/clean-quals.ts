/**
 * One-off: remove qualification entries whose key is no longer part of the
 * current model (leftovers from earlier versions, e.g. 'firearms', 'evaluator'),
 * and prune verifiedQualKeys to match. Only writes users that actually change.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const VALID = new Set(['general', 'handgun', 'carbine', 'dt', 'vehicle_ops', 'first_aid', 'role_player']);
// Scoped to the single account the user reported. Pass an email arg to target another.
const TARGET_EMAIL = process.argv[2] || 'jfinsmith@gmail.com';

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

(async () => {
  const snap = await db.collection('users').where('email', '==', TARGET_EMAIL).get();
  let changed = 0;
  for (const d of snap.docs) {
    const u = d.data();
    const quals = (u.qualifications ?? []) as { key: string }[];
    const verified = (u.verifiedQualKeys ?? []) as string[];
    const keptQuals = quals.filter((q) => VALID.has(q.key));
    const keptVerified = verified.filter((k) => VALID.has(k));
    const droppedQ = quals.filter((q) => !VALID.has(q.key)).map((q) => q.key);
    const droppedV = verified.filter((k) => !VALID.has(k));
    if (droppedQ.length === 0 && droppedV.length === 0) continue;
    await d.ref.update({
      qualifications: keptQuals,
      verifiedQualKeys: keptVerified,
      updatedAt: FieldValue.serverTimestamp(),
    });
    changed++;
    console.log(`${u.displayName}: dropped quals [${droppedQ.join(', ') || '—'}], dropped verified [${droppedV.join(', ') || '—'}]`);
  }
  console.log(`\nDone. Updated ${changed} user(s).`);
  process.exit(0);
})();
