/**
 * End-to-end check of the self-managed mail pipeline (sendQueuedEmail):
 *  1. queues a real test email (with a tiny .ics attachment, exercising the
 *     Buffer/base64 path) into `mailQueue` addressed to --to,
 *  2. watches the doc's delivery.state until SUCCESS/ERROR,
 *  3. confirms nothing wrote to the LEGACY `mail` collection recently
 *     (a recent doc there would mean some writer still targets the old
 *     extension queue — a silent black hole once it's uninstalled).
 *
 *   npx tsx scripts/test-mail-pipeline.ts --to you@example.com
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const toFlag = process.argv.indexOf('--to');
const TO = toFlag !== -1 ? process.argv[toFlag + 1] : '';
if (!TO || !TO.includes('@')) {
  console.error('Usage: npx tsx scripts/test-mail-pipeline.ts --to you@example.com');
  process.exit(1);
}

initializeApp({ credential: cert(sa as never) });
const db = getFirestore();

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//HEIMDALL//Mail pipeline test//EN',
  'BEGIN:VEVENT',
  'UID:mail-pipeline-test@heimdallscheduling.com',
  'DTSTART:20270101T140000Z',
  'DTEND:20270101T150000Z',
  'SUMMARY:HEIMDALL mail pipeline test event',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

async function main() {
  const stamp = new Date().toISOString();

  // 1) Queue the test email.
  const ref = await db.collection('mailQueue').add({
    to: [TO],
    from: 'HEIMDALL Scheduling <no-reply@heimdallscheduling.com>',
    message: {
      subject: `[HEIMDALL] Mail pipeline test — ${stamp}`,
      html: `<p>This is a <strong>test of the new self-managed mail pipeline</strong> (sendQueuedEmail → Resend).</p><p>Queued at ${stamp}. The attached .ics exercises the attachment path. Safe to delete.</p>`,
      text: `Test of the new self-managed mail pipeline (sendQueuedEmail → Resend). Queued at ${stamp}. Safe to delete.`,
      attachments: [{ filename: 'test.ics', content: ICS }],
    },
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`Queued mailQueue/${ref.id} → ${TO}`);

  // 2) Watch delivery.state (up to 90s).
  let lastState = '';
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const snap = await ref.get();
    const d = snap.data()?.delivery;
    const state = d?.state ?? '(no delivery field yet)';
    if (state !== lastState) {
      console.log(`  delivery.state: ${state}${d?.error ? ` — ${d.error}` : ''}`);
      lastState = state;
    }
    if (state === 'SUCCESS') {
      console.log(`✅ SENT — Resend message id: ${d?.info?.messageId ?? '(none)'} after ${d?.attempts ?? '?'} attempt(s).`);
      break;
    }
    if (state === 'ERROR') {
      console.error(`❌ FAILED permanently: ${d?.error}`);
      process.exitCode = 1;
      break;
    }
  }
  if (lastState !== 'SUCCESS' && lastState !== 'ERROR') {
    console.error('❌ TIMED OUT after 90s — check the function logs: firebase functions:log --only sendQueuedEmail');
    process.exitCode = 1;
  }

  // 3) Nothing should be writing to the LEGACY extension queue anymore.
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 60e3);
  const legacy = await db.collection('mail').where('createdAt', '>', cutoff).limit(5).get();
  if (legacy.empty) {
    console.log('✅ Legacy `mail` collection: no new docs in the last 30 min (all writers moved to mailQueue).');
  } else {
    console.error(`⚠ Legacy \`mail\` has ${legacy.size} doc(s) created in the last 30 min — something still writes to the OLD queue:`);
    for (const doc of legacy.docs) console.error(`   mail/${doc.id} — subject: ${doc.data().message?.subject ?? '?'}`);
    process.exitCode = 1;
  }
}

main().then(() => process.exit());
