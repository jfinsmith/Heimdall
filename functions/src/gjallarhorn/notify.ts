/**
 * Gjallarhorn notify() — the single abstraction every alert flows through.
 *
 * Writes an in-app `notifications` doc and (if the recipient's
 * notificationPrefs.email allows) a `mail` doc for the Trigger Email
 * extension. Future channels (SMS via Twilio, push) plug in here without
 * touching any trigger code — that's the extension point promised in §14.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { renderEmail, detailRows, EmailContent } from './templates';
import type { GlobalSettings, SessionDoc, UserDoc } from '../types';

const db = () => getFirestore();

export interface NotifyOptions {
  uid?: string;             // recipient uid (resolves email + prefs from users/{uid})
  email?: string;           // direct email (for escalationRecipients given as emails)
  type: string;
  title: string;
  body: string;
  link?: string;
  emailContent?: EmailContent;       // pre-rendered email; default renders from title/body
  attachments?: { filename: string; content: string }[];
  /** Skip the prefs check (critical command escalations always email). */
  force?: boolean;
}

export async function getSettings(): Promise<GlobalSettings | null> {
  const snap = await db().doc('settings/global').get();
  return snap.exists ? (snap.data() as GlobalSettings) : null;
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const settings = await getSettings();
  let email = opts.email ?? null;
  let prefsAllowEmail = true;

  if (opts.uid) {
    // In-app notification (bell)
    await db().collection('notifications').add({
      uid: opts.uid,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      link: opts.link ?? '',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    const userSnap = await db().doc(`users/${opts.uid}`).get();
    if (userSnap.exists) {
      const user = userSnap.data() as UserDoc;
      email = email ?? user.email;
      prefsAllowEmail = user.notificationPrefs?.email !== false;
    }
  }

  if (!email) return;
  if (!prefsAllowEmail && !opts.force) return;

  const content =
    opts.emailContent ??
    renderEmail({
      subject: `[HEIMDALL] ${opts.title}`,
      heading: opts.title,
      bodyHtml: opts.body.replace(/\n/g, '<br/>'),
      bodyText: opts.body,
      orgName: settings?.orgName,
    });

  // `mail` docs are server-written only; the Trigger Email extension sends them.
  await db().collection('mail').add({
    to: [email],
    message: {
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(opts.attachments ? { attachments: opts.attachments } : {}),
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Notify every coordinator of an academy (plus optional extra uids). */
export async function notifyCoordinators(
  academyId: string,
  payload: Omit<NotifyOptions, 'uid' | 'email'>,
  extraUids: string[] = []
): Promise<void> {
  const academy = await db().doc(`academies/${academyId}`).get();
  const coordinatorIds: string[] = academy.exists ? (academy.data()!.coordinatorIds ?? []) : [];
  const targets = [...new Set([...coordinatorIds, ...extraUids])];
  await Promise.all(targets.map((uid) => notify({ ...payload, uid })));
}

/** Escalate to the configured command recipients (uids or raw emails). */
export async function escalateToCommand(payload: Omit<NotifyOptions, 'uid' | 'email'>): Promise<void> {
  const settings = await getSettings();
  const recipients = settings?.escalationRecipients ?? [];
  await Promise.all(
    recipients.map((r) =>
      r.includes('@') ? notify({ ...payload, email: r, force: true }) : notify({ ...payload, uid: r, force: true })
    )
  );
}

/** Shared session-details block for emails. */
export function sessionDetails(session: SessionDoc): { html: string; text: string } {
  const fmt = (ts: FirebaseFirestore.Timestamp) =>
    ts.toDate().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
  return detailRows([
    ['Course', session.title || session.courseName],
    ['Starts', fmt(session.start)],
    ['Ends', fmt(session.end)],
    ['Location', `${session.location}${session.room ? ` — ${session.room}` : ''}`],
    ['Hours', String(session.hours)],
    ...(session.highLiability ? ([['Note', 'HIGH-LIABILITY COURSE']] as [string, string][]) : []),
  ]);
}

/** Minimal .ics VEVENT for sign-up confirmations. */
export function sessionIcs(sessionId: string, session: SessionDoc): string {
  const icsDate = (ts: FirebaseFirestore.Timestamp) =>
    ts.toDate().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HEIMDALL//Gjallarhorn//EN',
    'BEGIN:VEVENT',
    `UID:${sessionId}@heimdall`,
    `DTSTAMP:${icsDate(session.start)}`,
    `DTSTART:${icsDate(session.start)}`,
    `DTEND:${icsDate(session.end)}`,
    `SUMMARY:${(session.title || session.courseName).replace(/[,;]/g, ' ')}`,
    `LOCATION:${`${session.location} ${session.room}`.replace(/[,;]/g, ' ')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
