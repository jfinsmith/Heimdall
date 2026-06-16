/** Read-only: dump every user's qualifications + verifiedQualKeys + cert expiry. */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import sa from '../service-account.json';

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

(async () => {
  const snap = await db.collection('users').get();
  for (const d of snap.docs) {
    const u = d.data();
    const quals = (u.qualifications ?? []).map((q: any) => `${q.key}${q.verified ? '✓' : '·'}${q.attendedOn ? '(hasDate)' : ''}`);
    console.log(`\n${u.displayName} <${u.email}> [${d.id}]`);
    console.log(`  qualifications (${(u.qualifications ?? []).length}): ${quals.join(', ') || '—'}`);
    console.log(`  verifiedQualKeys: ${JSON.stringify(u.verifiedQualKeys ?? [])}`);
    console.log(`  instructorCertExpires: ${u.instructorCertExpires ? u.instructorCertExpires.toDate().toISOString().slice(0, 10) : '—'}`);
  }
  process.exit(0);
})();
