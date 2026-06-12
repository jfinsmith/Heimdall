/**
 * Gjallarhorn — Option B sweep (free Spark plan path).
 *
 * A standalone Node script that performs the daily reminder + understaffing
 * sweep using the Firebase Admin SDK and sends mail directly through an email
 * HTTP API (SendGrid shown; swap `sendEmail` for Mailgun/Resend/Postmark).
 * Triggered by .github/workflows/reminders-cron.yml.
 *
 * Auth: set FIREBASE_SERVICE_ACCOUNT (JSON content) or
 * GOOGLE_APPLICATION_CREDENTIALS (file path).
 *
 * NOTE: run EITHER this cron OR the scheduled Cloud Functions — not both.
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp({ credential: svc ? cert(JSON.parse(svc)) : applicationDefault() });
const db = getFirestore();

const MAIL_FROM = process.env.MAIL_FROM ?? 'HEIMDALL <no-reply@example.org>'; // TODO(setup)
const TIMEZONE = 'America/New_York';

// ── Email transport (SendGrid HTTP API; no SDK needed) ─────────────────────
async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const key = process.env.SENDGRID_API_KEY; // TODO(setup): or adapt to your provider
  if (!key) {
    console.log(`[dry-run] would email ${to}: ${subject}`);
    return;
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: MAIL_FROM.replace(/.*<|>.*/g, ''), name: 'HEIMDALL' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
}

function footerText(): string {
  return '\n--\nSounded by Gjallarhorn · HEIMDALL';
}
function wrapHtml(heading: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif"><h2 style="color:#16203a">${heading}</h2><pre style="font:13px/1.6 Arial">${body}</pre><p style="color:#6f86b5;font-size:11px">Sounded by Gjallarhorn · HEIMDALL</p></div>`;
}

async function notifyInApp(uid: string, type: string, title: string, body: string, link: string) {
  await db.collection('notifications').add({
    uid, type, title, body, link, read: false, createdAt: FieldValue.serverTimestamp(),
  });
}

// ── 1. Reminder sweep ───────────────────────────────────────────────────────
async function reminderSweep(): Promise<void> {
  const settings = (await db.doc('settings/global').get()).data() ?? {};
  const defaultLead = settings.reminderDefaultLeadHours ?? 48;
  const nowMs = Date.now();

  const snap = await db
    .collection('assignments')
    .where('status', '==', 'confirmed')
    .where('reminderSent', '==', false)
    .where('start', '>=', Timestamp.fromMillis(nowMs))
    .where('start', '<=', Timestamp.fromMillis(nowMs + 168 * 36e5))
    .get();

  let sent = 0;
  for (const docSnap of snap.docs) {
    const a = docSnap.data();
    const user = (await db.doc(`users/${a.uid}`).get()).data();
    if (!user) continue;
    const lead = user.notificationPrefs?.reminderLeadHours ?? defaultLead;
    if (a.start.toMillis() - nowMs > lead * 36e5) continue;

    const when = a.start.toDate().toLocaleString('en-US', { timeZone: TIMEZONE });
    const body = `You teach ${a.courseName} (${a.role}) on ${when} at ${a.location} ${a.room}.`;
    await notifyInApp(a.uid, 'reminder', `Reminder: ${a.courseName}`, body, '/my-schedule');
    if (user.notificationPrefs?.email !== false && user.email) {
      await sendEmail(user.email, `[HEIMDALL] Reminder — ${a.courseName}`, body + footerText(), wrapHtml('Upcoming assignment', body));
    }
    await docSnap.ref.update({ reminderSent: true });
    sent++;
  }
  console.log(`Reminders sent: ${sent}`);
}

// ── 2. Understaffing sweep ──────────────────────────────────────────────────
async function understaffingSweep(): Promise<void> {
  const settings = (await db.doc('settings/global').get()).data() ?? {};
  const alertDays = settings.understaffingAlertDays ?? 7;
  const nowMs = Date.now();

  const snap = await db
    .collection('sessions')
    .where('status', 'in', ['open', 'fully_staffed'])
    .where('start', '>=', Timestamp.fromMillis(nowMs))
    .where('start', '<=', Timestamp.fromMillis(nowMs + alertDays * 864e5))
    .get();

  const understaffed = snap.docs
    .map((d) => d.data())
    .filter((s) => s.roleSlots.some((sl: { filledBy: string[]; count: number }) => sl.filledBy.length < sl.count));
  if (understaffed.length === 0) {
    console.log('No understaffed sessions inside the alert window.');
    return;
  }

  const lines = understaffed.map((s) => {
    const missing = s.roleSlots
      .filter((sl: { filledBy: string[]; count: number }) => sl.filledBy.length < sl.count)
      .map((sl: { role: string; filledBy: string[]; count: number }) => `${sl.count - sl.filledBy.length}× ${sl.role}`)
      .join(', ');
    return `• ${s.title || s.courseName} — ${s.start.toDate().toLocaleString('en-US', { timeZone: TIMEZONE })} — missing ${missing}`;
  });
  const body = `${understaffed.length} session(s) within ${alertDays} days are missing required staff:\n\n${lines.join('\n')}`;

  const recipients: string[] = settings.escalationRecipients ?? [];
  for (const r of recipients) {
    if (r.includes('@')) {
      await sendEmail(r, `[HEIMDALL] Understaffing alert`, body + footerText(), wrapHtml('Understaffing alert', body));
    } else {
      const user = (await db.doc(`users/${r}`).get()).data();
      await notifyInApp(r, 'understaffing_alert', 'Understaffing alert', body, '/cadre/staffing');
      if (user?.email) {
        await sendEmail(user.email, `[HEIMDALL] Understaffing alert`, body + footerText(), wrapHtml('Understaffing alert', body));
      }
    }
  }
  console.log(`Understaffing alerts: ${understaffed.length} sessions → ${recipients.length} recipients`);
}

(async () => {
  console.log('Gjallarhorn Option-B sweep starting…');
  await reminderSweep();
  await understaffingSweep();
  console.log('Sweep complete.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
