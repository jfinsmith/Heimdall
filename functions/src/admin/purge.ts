/**
 * Account purge — keeps the platform-owner queue from silting up once signup
 * opens to the general population. Daily sweep over ORG-LESS accounts only
 * (a user doc with an orgId, or platformOwner, is never touched):
 *
 *   day 23  — warning email: "join an organization within 7 days or your
 *             account will be removed" (sent once; purgeWarnedAt marks it).
 *   day 30  — the Auth user AND the profile doc are deleted.
 *
 * NOTE: this is the third Cloud Scheduler job (daily Gjallarhorn + weekly
 * digest are the other two) — exactly the free tier's limit of 3.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { renderEmail, MAIL_FROM } from '../gjallarhorn/templates';

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

    for (const doc of snap.docs) {
      const u = doc.data() as {
        orgId?: string; platformOwner?: boolean; email?: string; displayName?: string;
        createdAt?: Timestamp; purgeWarnedAt?: Timestamp;
      };
      if (u.orgId || u.platformOwner === true) continue;
      const createdMs = u.createdAt?.toMillis?.();
      if (!createdMs) continue;
      const age = now - createdMs;

      if (age >= PURGE_AFTER_MS) {
        await getAuth().deleteUser(doc.id).catch(() => {}); // Auth record may already be gone
        await doc.ref.delete();
        purged++;
        continue;
      }

      if (age >= WARN_AFTER_MS && !u.purgeWarnedAt && u.email) {
        const name = (u.displayName ?? '').trim() || 'there';
        const content = renderEmail({
          subject: '[HEIMDALL] Action needed — your account will be removed in 7 days',
          heading: 'Your account is not linked to an organization',
          bodyHtml:
            `Hi ${name},<br/><br/>` +
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
        await db.collection('mail').add({
          to: [u.email],
          from: MAIL_FROM,
          message: { subject: content.subject, html: content.html, text: content.text },
          createdAt: FieldValue.serverTimestamp(),
        });
        await doc.ref.set({ purgeWarnedAt: FieldValue.serverTimestamp() }, { merge: true });
        warned++;
      }
    }

    console.log(`accountPurgeDaily: warned ${warned}, purged ${purged} (scanned ${snap.size}).`);
  }
);
