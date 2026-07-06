/**
 * Gjallarhorn notify() — the single abstraction every alert flows through.
 *
 * Writes an in-app `notifications` doc and (if the recipient's
 * notificationPrefs.email allows) a `mail` doc for the Trigger Email
 * extension. Future channels (SMS via Twilio, push) plug in here without
 * touching any trigger code — that's the extension point promised in §14.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { renderEmail, detailRows, escapeHtml, EmailContent } from './templates';
import { emailAllowed, GlobalSettings, Role, SessionDoc, UserDoc } from '../types';

const db = () => getFirestore();

export interface NotifyOptions {
  uid?: string;             // recipient uid (resolves email + prefs from users/{uid})
  email?: string;           // direct email (for escalationRecipients given as emails)
  /** Tenant whose settings (email toggles + org name) govern this email. For uid
   *  recipients it's resolved from the user doc; pass it for raw-email recipients. */
  orgId?: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  emailContent?: EmailContent;       // pre-rendered email; default renders from title/body
  attachments?: { filename: string; content: string }[];
  /**
   * Skip the RECIPIENT's opt-out (critical escalations always email) — does
   * NOT bypass the admin email-automation toggles or the master switch.
   */
  force?: boolean;
  /**
   * When set, the in-app notification and the mail doc are written with
   * deterministic ids derived from this key, so a Cloud Function retry (triggers
   * are at-least-once) re-uses the same docs instead of double-sending. Callers
   * derive it from the stable CloudEvent id + recipient.
   */
  dedupeKey?: string;
  /**
   * BASE curriculum key this notification broadcasts for (e.g. 'le_brt'). When
   * set and the recipient muted that discipline (notificationPrefs.mutedCurricula),
   * the notification is skipped ENTIRELY — no bell doc, no email. Only stamp this
   * on discipline-wide broadcasts (course-open announcements); never on personal
   * notifications (own assignment, own waitlist promotion, account notices).
   */
  curriculumKey?: string;
}

/** Create a doc idempotently — a retry with the same id is a no-op, not a duplicate. */
async function idempotentCreate(
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  try {
    await ref.create(data);
  } catch (e) {
    if ((e as { code?: number }).code === 6) return; // ALREADY_EXISTS — already delivered on a prior attempt
    throw e;
  }
}

export async function getSettings(orgId?: string): Promise<GlobalSettings | null> {
  // Per-org settings (doc id == orgId); 'global' fallback pre-backfill (dormant).
  const snap = await db().doc(`settings/${orgId || 'global'}`).get();
  return snap.exists ? (snap.data() as GlobalSettings) : null;
}

export async function notify(opts: NotifyOptions): Promise<void> {
  let email = opts.email ?? null;
  let prefsAllowEmail = true;
  let recipientRole: Role | undefined;
  // Whose org settings (email toggles + org name) govern this email: the
  // recipient's (from their user doc) or, for raw-email recipients, opts.orgId.
  let recipientOrgId: string | undefined = opts.orgId;

  if (opts.uid) {
    // Recipient doc FIRST: a curriculum-muted broadcast must be skipped entirely
    // (no bell doc, no email) — checked before anything is written.
    const userSnap = await db().doc(`users/${opts.uid}`).get();
    const user = userSnap.exists ? (userSnap.data() as UserDoc) : null;
    if (
      !opts.force &&
      opts.curriculumKey &&
      user?.notificationPrefs?.mutedCurricula?.includes(opts.curriculumKey)
    ) {
      return; // the recipient unsubscribed from this discipline's broadcasts
    }
    // In-app notification (bell) — deduped on retry when a dedupeKey is given.
    const notifData = {
      uid: opts.uid,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      link: opts.link ?? '',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (opts.dedupeKey) await idempotentCreate(db().collection('notifications').doc(`n_${opts.dedupeKey}`), notifData);
    else await db().collection('notifications').add(notifData);
    if (user) {
      email = email ?? user.email;
      recipientRole = user.role;
      recipientOrgId = user.orgId ?? opts.orgId;
      // Personal opt-outs apply ONLY to the user's own reminder/digest emails;
      // operational and command emails are governed by the admin toggles.
      if (opts.type === 'reminder') prefsAllowEmail = user.notificationPrefs?.email !== false;
      else if (opts.type === 'digest') prefsAllowEmail = user.notificationPrefs?.digest !== false;
      else prefsAllowEmail = true;
    }
  }

  if (!email) return;
  if (!prefsAllowEmail && !opts.force) return;
  // Load the recipient's ORG settings now that we know their org (email toggles
  // + org-name branding must come from the right tenant).
  const settings = await getSettings(recipientOrgId);
  // Admin-level controls: master switch + per-automation toggle + per-automation
  // recipient-role filter (Admin → Gjallarhorn & Email). The in-app bell above
  // already fired regardless.
  if (!emailAllowed(settings, opts.type, recipientRole)) return;

  const content =
    opts.emailContent ??
    renderEmail({
      subject: `[HEIMDALL] ${opts.title}`,
      heading: opts.title,
      // Escape before turning newlines into <br/> — bodies carry user-supplied
      // names / bulk-message text that must not inject HTML into the email.
      bodyHtml: escapeHtml(opts.body).replace(/\n/g, '<br/>'),
      bodyText: opts.body,
      orgName: settings?.orgName,
      logoUrl: settings?.logoUrl,
    });

  // `mail` docs are server-written only; the Trigger Email extension sends them.
  // Stamp the recipient's tenant so the same-tenant admin read rule can scope it.
  const mailData = {
    to: [email],
    message: {
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(opts.attachments ? { attachments: opts.attachments } : {}),
    },
    ...(recipientOrgId ? { orgId: recipientOrgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };
  if (opts.dedupeKey) await idempotentCreate(db().collection('mail').doc(`m_${opts.dedupeKey}`), mailData);
  else await db().collection('mail').add(mailData);
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
  await Promise.all(targets.map((uid) => notify({ ...payload, uid, dedupeKey: keyFor(payload.dedupeKey, uid) })));
}

/** Per-recipient dedupe id from a fan-out base key (undefined base = no dedupe). */
const keyFor = (base: string | undefined, uid: string) => (base ? `${base}_${uid}` : undefined);

/**
 * Notify every command-level admin (active directors + lieutenants). When an
 * orgId is given, only that tenant's admins are notified — pass it for any
 * org-specific event so command in OTHER orgs never receives it (or its PII).
 * Omit it (or pass undefined) for the single-tenant case (pre-backfill).
 */
export async function notifyAdmins(payload: Omit<NotifyOptions, 'uid' | 'email'>, orgId?: string): Promise<void> {
  let q: FirebaseFirestore.Query = db()
    .collection('users')
    .where('role', 'in', ['director', 'lieutenant'])
    .where('status', '==', 'active');
  if (orgId) q = q.where('orgId', '==', orgId);
  const admins = await q.get();
  await Promise.all(admins.docs.map((d) => notify({ ...payload, uid: d.id, dedupeKey: keyFor(payload.dedupeKey, d.id) })));
}

/** Escalate to the configured command recipients (uids or raw emails). */
export async function escalateToCommand(
  payload: Omit<NotifyOptions, 'uid' | 'email'>,
  orgId?: string
): Promise<void> {
  const settings = await getSettings(orgId);
  const recipients = settings?.escalationRecipients ?? [];
  await Promise.all(
    recipients.map((r) =>
      r.includes('@')
        ? notify({ ...payload, email: r, orgId, force: true, dedupeKey: keyFor(payload.dedupeKey, r) })
        : notify({ ...payload, uid: r, force: true, dedupeKey: keyFor(payload.dedupeKey, r) })
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
