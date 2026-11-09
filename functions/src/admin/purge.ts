/**
 * Account purge — keeps the platform-owner queue from silting up once signup
 * opens to the general population. Daily sweep over ORG-LESS accounts only
 * (a user doc with an orgId, platformOwner, or status 'active' is never touched):
 *
 *   day 23  — warning email: "join an organization within 7 days or your
 *             account will be removed" (sent once; purgeWarnedAt marks it).
 *   day 30  — the Auth user AND the profile doc are deleted.
 *
 * NOTE: one of the project's four Cloud Scheduler jobs (daily Gjallarhorn
 * sweep, weekly digest, the schedule-change flush and this one) — see index.ts.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { renderEmail, escapeHtml, MAIL_FROM, MAIL_QUEUE } from '../gjallarhorn/templates';

const WARN_AFTER_MS = 23 * 864e5;
const PURGE_AFTER_MS = 30 * 864e5;

export const accountPurgeDaily = onSchedule(
  { schedule: '30 7 * * *', timeZone: 'America/New_York' },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    // Org-less docs can't be queried directly (self-registered docs have NO
    // orgId field, and Firestore can't filter on a missing field) — scan and
    // filter. The users collection is small; this runs once a day.
    const snap = await db.collection('users').get();
    let warned = 0;
    let purged = 0;
    let skippedActive = 0;

    type PurgeCandidate = {
      orgId?: string; platformOwner?: boolean; status?: string; email?: string; displayName?: string;
      createdAt?: Timestamp; deniedAt?: Timestamp; purgeWarnedAt?: Timestamp;
    };
    /** Never purge (or warn) a member of an org, the platform owner, or an ACTIVE account. */
    const exempt = (x: PurgeCandidate) => !!x.orgId || x.platformOwner === true || x.status === 'active';

    for (const doc of snap.docs) {
      const u = doc.data() as PurgeCandidate;
      // Self-registered and denied accounts are 'pending'. An org-less account
      // that is ACTIVE was activated on purpose (owner / set-role script) or is
      // a real member whose orgId went missing — an anomaly for the owner to
      // repair, never something to delete on a timer.
      if (exempt(u)) {
        if (!u.orgId && u.platformOwner !== true) skippedActive++;
        continue;
      }
      const createdMs = u.createdAt?.toMillis?.();
      if (!createdMs) continue;
      // The clock restarts when an org denies the account (denyUser stamps
      // deniedAt + clears purgeWarnedAt) — it became org-less THEN, not at signup.
      const age = now - Math.max(createdMs, u.deniedAt?.toMillis?.() ?? 0);

      // One account's failure must not end the sweep for everyone after it.
      try {
        if (age >= PURGE_AFTER_MS) {
          // Re-read before deleting. `snap` can be minutes old by the time the
          // loop reaches this row (every warning email is awaited), and an account
          // that entered a join code or was assigned to an org in that window is
          // now a member — it must not be deleted on a stale read.
          const fresh = (await doc.ref.get()).data() as PurgeCandidate | undefined;
          if (!fresh || exempt(fresh)) continue;
          try {
            await getAuth().deleteUser(doc.id);
          } catch (err) {
            // Already gone is fine; anything else: keep the profile and retry
            // tomorrow rather than leave a login behind with no profile.
            if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
          }
          await db.recursiveDelete(doc.ref); // + users/{uid}/private/* (verification challenge)
          purged++;
          continue;
        }

        if (age >= WARN_AFTER_MS && !u.purgeWarnedAt && u.email) {
          const name = (u.displayName ?? '').trim() || 'there';
          const content = renderEmail({
            subject: '[HEIMDALL] Action needed — your account will be removed in 7 days',
            heading: 'Your account is not linked to an organization',
            bodyHtml:
              `Hi ${escapeHtml(name)},<br/><br/>` +
              `You created a HEIMDALL account but it isn't linked to a training academy yet. ` +
              `Accounts without an organization are removed after 30 days.<br/><br/>` +
              `To keep your account: sign in and enter your academy's <strong>join code</strong> ` +
              `(it's in your welcome email, or ask your coordinator). If you don't need the account, ` +
              `no action is required — it will be removed automatically.`,
            bodyText:
              `Hi ${name},\n\nYou created a HEIMDALL account but it isn't linked to a training academy yet. ` +
              `Accounts without an organization are removed after 30 days.\n\n` +
              `To keep your account: sign in at https://heimdallscheduling.com/signin and enter your academy's join code ` +
              `(it's in your welcome email, or ask your coordinator). If you don't need the account, no action is required.`,
            ctaLabel: 'Sign in and join',
            ctaUrl: 'https://heimdallscheduling.com/signin',
          });
          await db.collection(MAIL_QUEUE).add({
            to: [u.email],
            from: MAIL_FROM,
            message: { subject: content.subject, html: content.html, text: content.text },
            createdAt: FieldValue.serverTimestamp(),
          });
          await doc.ref.set({ purgeWarnedAt: FieldValue.serverTimestamp() }, { merge: true });
          warned++;
        }
      } catch (err) {
        console.error('accountPurgeDaily: account failed — will retry on the next run', doc.id, err);
      }
    }

    console.log(
      `accountPurgeDaily: warned ${warned}, purged ${purged}, left ${skippedActive} active org-less account(s) untouched (scanned ${snap.size}).`
    );
  }
);
