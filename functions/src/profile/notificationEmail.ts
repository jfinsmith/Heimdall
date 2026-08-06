/**
 * Secondary notification email — self-service, code-verified.
 *
 * A member may route ALL their notification mail to a different address than
 * the one they sign in with (agency inboxes get firewalled; personal inboxes
 * change). Proof of inbox control is a 6-digit code emailed to the NEW address:
 *
 *   requestNotificationEmail({ email })  → stores a code HASH in
 *     users/{uid}/private/notificationEmail (clients can read/write NOTHING
 *     under users/x/private — otherwise a member could read the code and
 *     "verify" an inbox they don't control), mirrors the pending address onto
 *     the user doc for display, and emails the code.
 *   confirmNotificationEmail({ code })   → checks hash/expiry/attempts and
 *     stamps notificationEmail + notificationEmailVerified on the user doc.
 *   clearNotificationEmail()             → reverts to the sign-in email.
 *
 * The user-doc fields are server-written ONLY (rules add unchanged() guards),
 * so notificationEmailVerified can never be forged from the client. Routing
 * happens in gjallarhorn/notify(): verified address replaces the sign-in email
 * as the single destination. Account/security mail (activation, password
 * resets, purge warnings) intentionally ignores this and uses the sign-in email.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash, randomInt } from 'crypto';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { renderEmail, MAIL_FROM } from '../gjallarhorn/templates';

const CODE_TTL_MS = 15 * 60 * 1000;      // code lives 15 minutes
const SEND_WINDOW_MS = 60 * 60 * 1000;   // max 5 code emails per rolling hour
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;                  // wrong guesses before the code dies

const codeHash = (uid: string, code: string) => createHash('sha256').update(`${uid}:${code}`).digest('hex');
const challengeRef = (uid: string) => getFirestore().doc(`users/${uid}/private/notificationEmail`);

interface Challenge {
  emailLower: string;
  codeHash: string;
  expiresAt: Timestamp;
  attempts: number;
  sendCount: number;
  windowStart: Timestamp;
}

export const requestNotificationEmail = onCall<{ email: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();
  const userSnap = await db.doc(`users/${caller.uid}`).get();
  if (!userSnap.exists) throw new HttpsError('failed-precondition', 'No profile found.');
  const user = userSnap.data() as { email?: string; displayName?: string; orgId?: string; status?: string };
  if (user.status === 'suspended' || user.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }

  const emailLower = (request.data.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailLower)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  if (emailLower === (user.email ?? '').toLowerCase()) {
    throw new HttpsError('invalid-argument', 'That is already your sign-in email — notifications go there by default.');
  }

  // Rolling-window send limit, tracked on the challenge doc itself.
  const now = Date.now();
  const prevSnap = await challengeRef(caller.uid).get();
  const prev = prevSnap.exists ? (prevSnap.data() as Challenge) : null;
  const windowLive = prev && now - prev.windowStart.toMillis() < SEND_WINDOW_MS;
  if (windowLive && prev!.sendCount >= MAX_SENDS_PER_WINDOW) {
    throw new HttpsError('resource-exhausted', 'Too many codes requested. Try again in an hour.');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await challengeRef(caller.uid).set({
    emailLower,
    codeHash: codeHash(caller.uid, code),
    expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
    attempts: 0,
    sendCount: windowLive ? prev!.sendCount + 1 : 1,
    windowStart: windowLive ? prev!.windowStart : Timestamp.fromMillis(now),
    ...(user.orgId ? { orgId: user.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${caller.uid}`).update({
    notificationEmailPending: emailLower,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const settingsSnap = user.orgId ? await db.doc(`settings/${user.orgId}`).get() : null;
  const content = renderEmail({
    subject: '[HEIMDALL] Your verification code',
    heading: 'Verify this notification address',
    bodyHtml:
      `Enter this code in HEIMDALL (Profile → Notification email) to start receiving your ` +
      `schedule notifications at this address:<br/><br/>` +
      `<div style="font-size:30px;font-weight:bold;letter-spacing:8px;text-align:center;padding:12px 0">${code}</div>` +
      `<br/>The code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    bodyText:
      `Enter this code in HEIMDALL (Profile → Notification email) to start receiving your ` +
      `schedule notifications at this address:\n\n${code}\n\n` +
      `The code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    orgName: settingsSnap?.exists ? (settingsSnap.data()!.orgName as string | undefined) : undefined,
    logoUrl: settingsSnap?.exists ? (settingsSnap.data()!.logoUrl as string | undefined) : undefined,
  });
  // Direct mail write — a verification code must bypass the automation toggles
  // and always deliver to the address being proven, not the routed destination.
  await db.collection('mail').add({
    to: [emailLower],
    from: MAIL_FROM,
    message: { subject: content.subject, html: content.html, text: content.text },
    ...(user.orgId ? { orgId: user.orgId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const confirmNotificationEmail = onCall<{ code: string }>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore();

  const snap = await challengeRef(caller.uid).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'No verification in progress — request a new code.');
  const ch = snap.data() as Challenge;
  if (Date.now() > ch.expiresAt.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'That code expired — request a new one.');
  }
  if (ch.attempts >= MAX_ATTEMPTS) {
    throw new HttpsError('resource-exhausted', 'Too many incorrect attempts — request a new code.');
  }
  const code = (request.data.code ?? '').trim();
  if (codeHash(caller.uid, code) !== ch.codeHash) {
    await challengeRef(caller.uid).update({ attempts: FieldValue.increment(1) });
    throw new HttpsError('invalid-argument', 'Incorrect code.');
  }

  await db.doc(`users/${caller.uid}`).update({
    notificationEmail: ch.emailLower,
    notificationEmailVerified: true,
    notificationEmailPending: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await challengeRef(caller.uid).delete();
  return { ok: true, email: ch.emailLower };
});

export const clearNotificationEmail = onCall<{ pendingOnly?: boolean } | undefined>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  // pendingOnly abandons an in-flight change while KEEPING any already-verified
  // address; the full clear reverts everything to the sign-in email.
  const pendingOnly = request.data?.pendingOnly === true;
  await getFirestore().doc(`users/${caller.uid}`).update({
    ...(pendingOnly
      ? {}
      : { notificationEmail: FieldValue.delete(), notificationEmailVerified: FieldValue.delete() }),
    notificationEmailPending: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await challengeRef(caller.uid).delete();
  return { ok: true };
});
