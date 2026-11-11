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
import { refuseViewer } from '../viewer/guard';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { renderEmail, MAIL_FROM, MAIL_QUEUE } from '../gjallarhorn/templates';

const CODE_TTL_MS = 15 * 60 * 1000;      // code lives 15 minutes
const SEND_WINDOW_MS = 60 * 60 * 1000;   // max 5 code emails per rolling hour
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;                  // wrong guesses before the code dies

const codeHash = (uid: string, code: string) => createHash('sha256').update(`${uid}:${code}`).digest('hex');
/** Constant-time string equality (both sides hashed first, so length never leaks or throws). */
const safeEqual = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
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
  refuseViewer(caller.token);
  const db = getFirestore();
  const userSnap = await db.doc(`users/${caller.uid}`).get();
  if (!userSnap.exists) throw new HttpsError('failed-precondition', 'No profile found.');
  const user = userSnap.data() as { email?: string; displayName?: string; orgId?: string; status?: string };
  if (user.status === 'suspended' || user.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
  refuseViewer(null, user);

  const rawEmail: unknown = request.data?.email;
  const emailLower = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  // 254 = the longest deliverable address; the pattern alone accepted megabytes.
  if (emailLower.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailLower)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  if (emailLower === (user.email ?? '').toLowerCase()) {
    throw new HttpsError('invalid-argument', 'That is already your sign-in email — notifications go there by default.');
  }

  // Rolling-window send limit, tracked on the challenge doc itself. The check
  // and the bump run in ONE transaction: as a separate read and write, parallel
  // requests all read the same count and every one of them got a code email
  // sent to the (still unproven) address.
  const now = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const allowed = await db.runTransaction(async (tx) => {
    const prevSnap = await tx.get(challengeRef(caller.uid));
    const prev = prevSnap.exists ? (prevSnap.data() as Challenge) : null;
    const windowLive = !!prev && now - prev.windowStart.toMillis() < SEND_WINDOW_MS;
    if (windowLive && prev!.sendCount >= MAX_SENDS_PER_WINDOW) return false;
    tx.set(challengeRef(caller.uid), {
      emailLower,
      codeHash: codeHash(caller.uid, code),
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
      attempts: 0,
      sendCount: windowLive ? prev!.sendCount + 1 : 1,
      windowStart: windowLive ? prev!.windowStart : Timestamp.fromMillis(now),
      ...(user.orgId ? { orgId: user.orgId } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'Too many codes requested. Try again in an hour.');
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
  await db.collection(MAIL_QUEUE).add({
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
  refuseViewer(caller.token);
  const db = getFirestore();

  const rawCode: unknown = request.data?.code;
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  // Check, count and consume in ONE transaction. As separate steps, a burst of
  // parallel guesses all read "attempts < 5" before any increment landed, so
  // the five-try limit on a six-digit code did not hold.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(challengeRef(caller.uid));
    if (!snap.exists) return { kind: 'none' as const };
    const ch = snap.data() as Challenge;
    if (Date.now() > ch.expiresAt.toMillis()) return { kind: 'expired' as const };
    if (ch.attempts >= MAX_ATTEMPTS) return { kind: 'locked' as const };
    if (!safeEqual(codeHash(caller.uid, code), ch.codeHash)) {
      tx.update(challengeRef(caller.uid), { attempts: FieldValue.increment(1) });
      return { kind: 'wrong' as const };
    }
    tx.update(db.doc(`users/${caller.uid}`), {
      notificationEmail: ch.emailLower,
      notificationEmailVerified: true,
      notificationEmailPending: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(challengeRef(caller.uid));
    return { kind: 'ok' as const, email: ch.emailLower };
  });

  // 'failed-precondition' on purpose for the expired / used-up cases: the web
  // client's friendlyError() replaces 'deadline-exceeded' and
  // 'resource-exhausted' with generic transport text ("the server didn't
  // respond in time", "wait a moment and try again"), which hid the one thing
  // the member has to do — request a new code.
  if (outcome.kind === 'none') throw new HttpsError('failed-precondition', 'No verification in progress — request a new code.');
  if (outcome.kind === 'expired') throw new HttpsError('failed-precondition', 'That code expired — request a new one.');
  if (outcome.kind === 'locked') throw new HttpsError('failed-precondition', 'Too many incorrect attempts — request a new code.');
  if (outcome.kind === 'wrong') throw new HttpsError('invalid-argument', 'Incorrect code.');
  return { ok: true, email: outcome.email };
});

export const clearNotificationEmail = onCall<{ pendingOnly?: boolean } | undefined>(async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required.');
  refuseViewer(caller.token);
  // pendingOnly abandons an in-flight change while KEEPING any already-verified
  // address; the full clear reverts everything to the sign-in email.
  const pendingOnly = request.data?.pendingOnly === true;
  // The stored role too: suspension strips the role claim from the token.
  refuseViewer(null, (await getFirestore().doc(`users/${caller.uid}`).get()).data());
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
