/**
 * Gjallarhorn — scheduled sweeps (§8).
 *
 * Cloud Scheduler allows 3 free jobs, so the daily work is consolidated into
 * ONE function (reminders + understaffing) and the weekly digest is a second:
 * 2 jobs total. Times/timezone are constants below — adjust as needed.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { escalateToCommand, getSettings, notify, notifyCoordinators, sessionDetails } from './notify';
import { renderEmail } from './templates';
import type { AssignmentDoc, SessionDoc, UserDoc } from '../types';

const TIMEZONE = 'America/New_York';   // TODO(setup): adjust if the agency is elsewhere
const DAILY_AT = '0 7 * * *';          // 07:00 ET daily
const WEEKLY_AT = '0 6 * * 1';         // 06:00 ET Mondays

const db = () => getFirestore();

function unfilled(session: SessionDoc) {
  return session.roleSlots.filter((s) => s.filledBy.length < s.count);
}

// ── Daily: reminders + understaffing in one job ─────────────────────────────
export const gjallarhornDailySweep = onSchedule(
  { schedule: DAILY_AT, timeZone: TIMEZONE },
  async () => {
    const settings = await getSettings();
    const defaultLead = settings?.reminderDefaultLeadHours ?? 48;
    const alertDays = settings?.understaffingAlertDays ?? 7;
    const now = Date.now();

    // ── 1. Reminder sweep ──────────────────────────────────────────────────
    // Assignments starting within the maximum possible lead window that have
    // not been reminded; each user's own reminderLeadHours decides the cut.
    const maxLeadMs = 168 * 36e5; // 7-day ceiling on per-user lead times
    const upcoming = await db()
      .collection('assignments')
      .where('status', '==', 'confirmed')
      .where('reminderSent', '==', false)
      .where('start', '>=', Timestamp.fromMillis(now))
      .where('start', '<=', Timestamp.fromMillis(now + maxLeadMs))
      .get();

    for (const doc of upcoming.docs) {
      const a = doc.data() as AssignmentDoc;
      const userSnap = await db().doc(`users/${a.uid}`).get();
      const user = userSnap.exists ? (userSnap.data() as UserDoc) : null;
      const leadHours = user?.notificationPrefs?.reminderLeadHours ?? defaultLead;
      if (a.start.toMillis() - now > leadHours * 36e5) continue; // not yet inside the user's window

      const sessionSnap = await db().doc(`sessions/${a.sessionId}`).get();
      const session = sessionSnap.exists ? (sessionSnap.data() as SessionDoc) : null;
      const details = session ? sessionDetails(session) : { html: '', text: '' };

      await notify({
        uid: a.uid,
        // One reminder per (assignment, start-time) ever — survives retries; a
        // reschedule changes start and legitimately re-arms a fresh reminder.
        dedupeKey: `reminder_${doc.id}_${a.start.toMillis()}`,
        type: 'reminder',
        title: `Reminder: ${a.courseName}`,
        body: `You teach ${a.courseName} (${a.role.replace('_', ' ')}) on ${a.start
          .toDate()
          .toLocaleString('en-US', { timeZone: TIMEZONE })}.`,
        link: '/my-schedule',
        emailContent: renderEmail({
          subject: `[HEIMDALL] Reminder — ${a.courseName}`,
          heading: 'Upcoming assignment',
          bodyHtml: `<p>The horn sounds: you have an assignment coming up.</p>${details.html}`,
          bodyText: `The horn sounds: you have an assignment coming up.\n\n${details.text}`,
          orgName: settings?.orgName,
          logoUrl: settings?.logoUrl,
        }),
      });
      await doc.ref.update({ reminderSent: true });
    }

    // ── 2. Understaffing sweep ─────────────────────────────────────────────
    const horizon = Timestamp.fromMillis(now + alertDays * 864e5);
    const sessions = await db()
      .collection('sessions')
      .where('status', 'in', ['open', 'fully_staffed'])
      .where('start', '>=', Timestamp.fromMillis(now))
      .where('start', '<=', horizon)
      .get();

    const understaffed = sessions.docs
      .map((d) => ({ id: d.id, data: d.data() as SessionDoc }))
      .filter(({ data }) => unfilled(data).length > 0);

    if (understaffed.length > 0) {
      const lines = understaffed.map(({ data }) => {
        const missing = unfilled(data)
          .map((s) => `${s.count - s.filledBy.length}× ${s.role.replace('_', ' ')}`)
          .join(', ');
        return `• ${data.title || data.courseName} — ${data.start
          .toDate()
          .toLocaleString('en-US', { timeZone: TIMEZONE })} — missing ${missing}`;
      });
      const body = `${understaffed.length} session(s) within ${alertDays} days are missing required staff:\n\n${lines.join('\n')}`;

      // Coordinators of each affected academy + the command escalation list.
      // dayKey makes a retried daily run on the same date idempotent.
      const dayKey = new Date(now).toISOString().slice(0, 10);
      const academyIds = [...new Set(understaffed.map(({ data }) => data.academyId))];
      for (const academyId of academyIds) {
        await notifyCoordinators(academyId, {
          dedupeKey: `understaff_${dayKey}_${academyId}`,
          type: 'understaffing_alert',
          title: `Understaffing alert — ${understaffed.length} session(s) inside ${alertDays} days`,
          body,
          link: '/cadre/staffing',
        });
      }
      await escalateToCommand({
        dedupeKey: `understaff_${dayKey}_cmd`,
        type: 'understaffing_alert',
        title: `Understaffing alert — ${understaffed.length} session(s) inside ${alertDays} days`,
        body,
        link: '/cadre/staffing',
      });
    }
  }
);

// ── Weekly digest ───────────────────────────────────────────────────────────
export const gjallarhornWeeklyDigest = onSchedule(
  { schedule: WEEKLY_AT, timeZone: TIMEZONE },
  async () => {
    const settings = await getSettings();
    if (settings?.weeklyDigestEnabled === false) return;
    const now = Date.now();
    const horizon = Timestamp.fromMillis(now + 14 * 864e5);

    const sessions = await db()
      .collection('sessions')
      .where('start', '>=', Timestamp.fromMillis(now))
      .where('start', '<=', horizon)
      .get();

    const all = sessions.docs.map((d) => d.data() as SessionDoc).filter((s) => s.status !== 'cancelled');
    const open = all.filter((s) => unfilled(s).length > 0);
    const staffed = all.filter((s) => unfilled(s).length === 0);
    const openSlotCount = open.reduce(
      (n, s) => n + unfilled(s).reduce((m, slot) => m + (slot.count - slot.filledBy.length), 0),
      0
    );

    const body = [
      `Staffing health for the next 14 days:`,
      ``,
      `  Sessions scheduled: ${all.length}`,
      `  Fully staffed:      ${staffed.length}`,
      `  Understaffed:       ${open.length} (${openSlotCount} open slots)`,
      ``,
      ...open
        .slice(0, 15)
        .map(
          (s) =>
            `• ${s.title || s.courseName} — ${s.start
              .toDate()
              .toLocaleDateString('en-US', { timeZone: TIMEZONE })} — ${unfilled(s)
              .map((slot) => `${slot.count - slot.filledBy.length}× ${slot.role.replace('_', ' ')}`)
              .join(', ')}`
        ),
      open.length > 15 ? `…and ${open.length - 15} more.` : '',
    ].join('\n');

    // Digest goes to all staff (coordinator+) who haven't opted out.
    const staff = await db()
      .collection('users')
      .where('role', 'in', ['coordinator', 'sergeant', 'lieutenant', 'director'])
      .where('status', '==', 'active')
      .get();

    // weekKey makes a double-invoked weekly run idempotent (one digest per week).
    const weekKey = new Date(now).toISOString().slice(0, 10);
    await Promise.all(
      staff.docs
        .filter((d) => (d.data() as UserDoc).notificationPrefs?.digest !== false)
        .map((d) =>
          notify({
            uid: d.id,
            dedupeKey: `digest_${weekKey}_${d.id}`,
            type: 'digest',
            title: 'Weekly staffing digest',
            body,
            link: '/cadre/staffing',
          })
        )
    );
  }
);
