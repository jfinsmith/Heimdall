/**
 * Schedule-change QUIET PERIOD. A coordinator who drags a block from 07:00 to
 * 07:45 and then to 08:00 has made one change, not two — but every session
 * write is a separate trigger, so instructors used to get two contradictory
 * emails seconds apart (the first one wrong). Changes are now queued per
 * session and announced only once the session has sat untouched for the org's
 * quiet period (default 5 min): ONE notice describing the net change from
 * what instructors last knew (the `before` of the FIRST edit in the burst) to
 * the final state. A drag-and-undo nets to nothing and sends nothing.
 *
 * Assignment mirrors (My Schedule times, reminder re-arm) still sync on every
 * write — only the notification is deferred.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { getSettings, notify, sessionDetails } from './notify';
import { renderEmail, escapeHtml } from './templates';
import type { ScheduleChangeQueueDoc, SessionDoc, SignupDoc } from '../types';

const db = () => getFirestore();
const DEFAULT_QUIET_MINUTES = 5;
const FLUSH_EVERY = '*/2 * * * *';

/** The slice of a session instructors were last told about. */
export function changeSnapshot(s: SessionDoc): ScheduleChangeQueueDoc['before'] {
  return { start: s.start, end: s.end, room: s.room ?? '', location: s.location ?? '', status: s.status };
}

/**
 * Record a change for later announcement. First change of a burst captures
 * `before` (what instructors last knew); later changes only push the timer.
 */
export async function enqueueScheduleChange(sessionId: string, before: SessionDoc, after: SessionDoc): Promise<void> {
  const settings = await getSettings(after.orgId);
  const quietMin = Math.min(60, Math.max(1, settings?.scheduleChangeQuietMinutes ?? DEFAULT_QUIET_MINUTES));
  const now = Timestamp.now();
  const notifyAfter = Timestamp.fromMillis(now.toMillis() + quietMin * 60e3);
  const ref = db().doc(`scheduleChangeQueue/${sessionId}`);
  await db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) {
      tx.update(ref, { notifyAfter, lastChangedAt: now, ...(after.updatedBy ? { editedBy: after.updatedBy } : {}) });
      return;
    }
    const doc: ScheduleChangeQueueDoc = {
      ...(after.orgId ? { orgId: after.orgId } : {}),
      academyId: after.academyId,
      sessionId,
      before: changeSnapshot(before),
      firstChangedAt: now,
      lastChangedAt: now,
      notifyAfter,
      ...(after.updatedBy ? { editedBy: after.updatedBy } : {}),
    };
    tx.set(ref, doc);
  });
}

const fmtTime = (t: Timestamp) => t.toDate().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const fmtDay = (t: Timestamp) => t.toDate().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const span = (start: Timestamp, end: Timestamp) => `${fmtDay(start)}, ${fmtTime(start)}–${fmtTime(end)}`;

/** Every 2 minutes: announce bursts whose quiet period has elapsed. */
export const gjallarhornChangeFlush = onSchedule({ schedule: FLUSH_EVERY, timeZone: 'America/New_York' }, async () => {
  const due = await db().collection('scheduleChangeQueue').where('notifyAfter', '<=', Timestamp.now()).limit(100).get();
  for (const qDoc of due.docs) {
    const q = qDoc.data() as ScheduleChangeQueueDoc;
    try {
      const sessionSnap = await db().doc(`sessions/${q.sessionId}`).get();
      if (!sessionSnap.exists) {
        await qDoc.ref.delete(); // deleted outright — nothing to describe
        continue;
      }
      const after = sessionSnap.data() as SessionDoc;
      const before = q.before;
      const timeChanged = before.start.toMillis() !== after.start.toMillis() || before.end.toMillis() !== after.end.toMillis();
      const roomChanged = before.room !== (after.room ?? '') || before.location !== (after.location ?? '');
      const cancelled = before.status !== 'cancelled' && after.status === 'cancelled';
      // Drag-and-undo (or edited straight back): net nothing — say nothing.
      if (!timeChanged && !roomChanged && !cancelled) {
        await qDoc.ref.delete();
        continue;
      }
      const signups = await db().collection(`sessions/${q.sessionId}/signups`).where('status', '==', 'confirmed').get();
      const settings = await getSettings(after.orgId);
      const details = sessionDetails(after);
      const what = cancelled ? 'CANCELLED' : timeChanged ? 'rescheduled' : 'moved rooms';
      const label = after.title || after.courseName;
      // Spell out old → new so the ONE email is unambiguous.
      const diffText = cancelled
        ? `Was: ${span(before.start, before.end)}${before.room ? ` — ${before.room}` : ''}.`
        : [
            timeChanged ? `Time: ${span(before.start, before.end)} → ${span(after.start, after.end)}` : '',
            roomChanged ? `Room: ${before.room || before.location || '—'} → ${after.room || after.location || '—'}` : '',
          ]
            .filter(Boolean)
            .join('\n');
      const diffHtml = `<p>${escapeHtml(diffText).replace(/\n/g, '<br/>')}</p>`;
      await Promise.all(
        signups.docs.map(async (d) => {
          const su = d.data() as SignupDoc;
          if (su.uid === q.editedBy) return; // the person who made the (last) change knows
          if (su.reservationState === 'pending' && su.offerNotified !== true) return; // never told of the session
          await notify({
            uid: su.uid,
            dedupeKey: `sc_${q.sessionId}_${q.firstChangedAt.toMillis()}_${su.uid}`,
            type: 'schedule_change',
            title: `Schedule change: ${label} ${what}`,
            body: cancelled
              ? 'This session has been cancelled. You are released from this assignment.'
              : `Your session has been ${what}. ${diffText.replace(/\n/g, ' · ')}`,
            link: '/my-schedule',
            force: cancelled, // cancellations always email
            emailContent: renderEmail({
              subject: `[HEIMDALL] ${cancelled ? 'CANCELLED' : 'Schedule change'} — ${label}`,
              heading: cancelled ? 'Session cancelled' : `Session ${what}`,
              bodyHtml: `<p>${escapeHtml(su.displayName)}, your assigned session has been <strong>${what}</strong>.</p>${diffHtml}${details.html}`,
              bodyText: `${su.displayName}, your assigned session has been ${what}.\n\n${diffText}\n\n${details.text}`,
              ctaLabel: 'View My Schedule',
              ctaUrl: 'https://heimdallscheduling.com/my-schedule',
              orgName: settings?.orgName,
              logoUrl: settings?.logoUrl,
            }),
          });
        })
      );
      await qDoc.ref.delete();
    } catch (err) {
      // One bad entry must not block the rest; it stays queued and retries
      // next run (the dedupe key makes a partial fan-out safe to repeat).
      logger.error(`scheduleChangeQueue/${qDoc.id} flush failed`, err);
      await qDoc.ref.update({ notifyAfter: Timestamp.fromMillis(Date.now() + 10 * 60e3), error: String(err) }).catch(() => {});
    }
  }
});
