/**
 * Gjallarhorn — event-driven Firestore triggers (§8).
 *
 *  - sign-up confirmation (email + .ics)
 *  - withdrawal / slot re-opened → coordinators
 *  - session fully staffed → coordinators
 *  - lead withdrawal < N days out → coordinators + command escalation
 *  - schedule change (time/room/cancel with sign-ups) → signed-up instructors
 *  - qualification verification & account approval → affected user
 *  - bulk message fan-out
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  escalateToCommand,
  getSettings,
  notify,
  notifyCoordinators,
  sessionDetails,
  sessionIcs,
} from './notify';
import { renderEmail } from './templates';
import type { AssignmentDoc, SessionDoc, SignupDoc, UserDoc } from '../types';

const db = () => getFirestore();
const LEAD_ESCALATION_DAYS = 7; // lead withdrawal inside this window escalates to command

async function getSession(sessionId: string): Promise<SessionDoc | null> {
  const snap = await db().doc(`sessions/${sessionId}`).get();
  return snap.exists ? (snap.data() as SessionDoc) : null;
}

// ── Sign-up lifecycle ───────────────────────────────────────────────────────
export const onSignupWritten = onDocumentWritten('sessions/{sessionId}/signups/{uid}', async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as SignupDoc) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as SignupDoc) : null;
  if (!after) return;
  const { sessionId, uid } = event.params;
  const session = await getSession(sessionId);
  if (!session) return;
  const settings = await getSettings();

  const becameConfirmed = after.status === 'confirmed' && before?.status !== 'confirmed';
  const becameWithdrawn = after.status === 'withdrawn' && before?.status !== 'withdrawn';

  if (becameConfirmed) {
    // 1) Confirmation to the instructor, with session details + .ics
    const details = sessionDetails(session);
    await notify({
      uid,
      type: 'signup_confirmed',
      title: `Confirmed: ${session.title || session.courseName}`,
      body: `You are confirmed as ${after.role.replace('_', ' ')}.`,
      link: `/my-schedule`,
      emailContent: renderEmail({
        subject: `[HEIMDALL] Confirmed — ${session.title || session.courseName}`,
        heading: 'Assignment confirmed',
        bodyHtml: `<p>${after.displayName}, you are confirmed as <strong>${after.role.replace('_', ' ')}</strong>.</p>${details.html}`,
        bodyText: `${after.displayName}, you are confirmed as ${after.role.replace('_', ' ')}.\n\n${details.text}`,
        orgName: settings?.orgName,
      }),
      attachments: [{ filename: 'session.ics', content: sessionIcs(sessionId, session) }],
    });
  }

  if (becameWithdrawn) {
    // 2) Withdrawal / slot re-opened → coordinators
    await notifyCoordinators(session.academyId, {
      type: 'slot_reopened',
      title: `Slot re-opened: ${session.title || session.courseName}`,
      body: `${after.displayName} withdrew from the ${after.role.replace('_', ' ')} slot on ${session.start
        .toDate()
        .toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.`,
      link: `/cadre/staffing`,
    });

    // 3) Lead withdrawal close to the session date → escalate up the chain
    const daysOut = (session.start.toMillis() - Date.now()) / 864e5;
    if (after.role === 'lead' && daysOut <= LEAD_ESCALATION_DAYS && daysOut > 0) {
      await escalateToCommand({
        type: 'lead_withdrawal_escalation',
        title: `ESCALATION — lead withdrew ${Math.ceil(daysOut)} days out`,
        body: `${after.displayName} withdrew as LEAD for "${session.title || session.courseName}" on ${session.start
          .toDate()
          .toLocaleString('en-US', { timeZone: 'America/New_York' })}. The session has no confirmed replacement.`,
        link: `/cadre/staffing`,
      });
    }
  }
});

// ── Session changes ─────────────────────────────────────────────────────────
export const onSessionUpdated = onDocumentUpdated('sessions/{sessionId}', async (event) => {
  const before = event.data?.before.data() as SessionDoc | undefined;
  const after = event.data?.after.data() as SessionDoc | undefined;
  if (!before || !after) return;
  const sessionId = event.params.sessionId;

  // 4) Fully staffed → coordinators
  if (before.status !== 'fully_staffed' && after.status === 'fully_staffed') {
    await notifyCoordinators(after.academyId, {
      type: 'session_fully_staffed',
      title: `Fully staffed: ${after.title || after.courseName}`,
      body: `All role slots filled for ${after.start
        .toDate()
        .toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.`,
      link: `/cadre/staffing`,
    });
  }

  // 5) Schedule change (time/room/cancel) with sign-ups → all signed-up instructors
  const timeChanged =
    before.start.toMillis() !== after.start.toMillis() || before.end.toMillis() !== after.end.toMillis();
  const roomChanged = before.room !== after.room || before.location !== after.location;
  const cancelled = before.status !== 'cancelled' && after.status === 'cancelled';
  if (!timeChanged && !roomChanged && !cancelled) return;

  const signups = await db()
    .collection(`sessions/${sessionId}/signups`)
    .where('status', '==', 'confirmed')
    .get();
  if (signups.empty) return;

  const settings = await getSettings();
  const details = sessionDetails(after);
  const what = cancelled ? 'CANCELLED' : timeChanged ? 'rescheduled' : 'moved rooms';

  await Promise.all(
    signups.docs.map(async (d) => {
      const su = d.data() as SignupDoc;
      // Keep the assignment mirror in sync for reminders/My Schedule.
      await db()
        .doc(`assignments/${sessionId}_${su.uid}`)
        .set(
          cancelled
            ? { status: 'withdrawn' }
            : { start: after.start, end: after.end, room: after.room, location: after.location, reminderSent: false },
          { merge: true }
        );
      await notify({
        uid: su.uid,
        type: 'schedule_change',
        title: `Schedule change: ${after.title || after.courseName} ${what}`,
        body: cancelled
          ? 'This session has been cancelled. You are released from this assignment.'
          : `Your session has been ${what}. Check the updated details.`,
        link: '/my-schedule',
        force: cancelled, // cancellations always email
        emailContent: renderEmail({
          subject: `[HEIMDALL] ${cancelled ? 'CANCELLED' : 'Schedule change'} — ${after.title || after.courseName}`,
          heading: cancelled ? 'Session cancelled' : `Session ${what}`,
          bodyHtml: `<p>${su.displayName}, your assigned session has been <strong>${what}</strong>.</p>${details.html}`,
          bodyText: `${su.displayName}, your assigned session has been ${what}.\n\n${details.text}`,
          orgName: settings?.orgName,
        }),
      });
    })
  );
});

// ── User account / qualification approvals ─────────────────────────────────
export const onUserUpdated = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data?.before.data() as UserDoc | undefined;
  const after = event.data?.after.data() as UserDoc | undefined;
  if (!before || !after) return;
  const uid = event.params.uid;

  // 6a) Account approved
  if (before.status === 'pending' && after.status === 'active') {
    await notify({
      uid,
      type: 'account_approved',
      title: 'Your HEIMDALL account is active',
      body: 'A coordinator approved your account. You can now sign up for sessions you qualify for.',
      link: '/open-sessions',
    });
  }

  // 6b) Qualification newly verified
  const beforeVerified = new Set(before.qualifications.filter((q) => q.verified).map((q) => q.key));
  const newlyVerified = after.qualifications.filter((q) => q.verified && !beforeVerified.has(q.key));
  for (const q of newlyVerified) {
    await notify({
      uid,
      type: 'qualification_approved',
      title: `Qualification verified: ${q.label}`,
      body: 'You can now fill slots that require this qualification.',
      link: '/open-sessions',
    });
  }
});

// ── Course opened for sign-up (aggregated — one email per instructor, not
//    one per session). The builder writes a single coursePublishEvents doc
//    when a course's sign-ups open. ──────────────────────────────────────────
export const onCoursePublished = onDocumentCreated('coursePublishEvents/{id}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const { academyId, courseLabel, sessionCount } = data as { academyId: string; courseLabel: string; sessionCount: number };

  // Union of qualification requirements across the course's open, unfilled slots.
  const sessions = await db().collection('sessions').where('academyId', '==', academyId).get();
  const slotQuals = new Set<string>();
  let anyUnrestricted = false;
  let earliest: FirebaseFirestore.Timestamp | null = null;
  for (const d of sessions.docs) {
    const s = d.data() as SessionDoc;
    if ((s.title || s.courseName) !== courseLabel) continue;
    if (s.status !== 'open' && s.status !== 'fully_staffed') continue;
    if (!earliest || s.start.toMillis() < earliest.toMillis()) earliest = s.start;
    for (const slot of s.roleSlots) {
      if (slot.filledBy.length >= slot.count) continue;
      if (slot.requiredQualificationKey) slotQuals.add(slot.requiredQualificationKey);
      else anyUnrestricted = true;
    }
  }

  const academy = await db().doc(`academies/${academyId}`).get();
  const academyLabel = academy.exists ? (academy.data()!.shortName || academy.data()!.name) : '';

  const users = await db().collection('users').where('status', '==', 'active').get();
  const eligible = users.docs.filter((d) => {
    const u = d.data() as UserDoc;
    return anyUnrestricted || (u.verifiedQualKeys ?? []).some((k) => slotQuals.has(k));
  });

  const firstDay = earliest
    ? earliest.toDate().toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })
    : '';
  await Promise.all(
    eligible.map((d) =>
      notify({
        uid: d.id,
        type: 'course_published',
        title: `Sign-ups open: ${academyLabel} ${courseLabel}`,
        body: `${courseLabel} (${sessionCount} session${sessionCount === 1 ? '' : 's'}${firstDay ? `, starting ${firstDay}` : ''}) is now open for instructor sign-up in ${academyLabel}.`,
        link: '/open-sessions',
      })
    )
  );
});

// ── Bulk message fan-out (from the Staffing Board) ─────────────────────────
export const onBulkMessageCreated = onDocumentCreated('bulkMessages/{id}', async (event) => {
  const data = event.data?.data();
  if (!data || data.status !== 'pending') return;

  // Audience: instructors with upcoming confirmed assignments (optionally per academy).
  let q = db().collection('assignments').where('status', '==', 'confirmed') as FirebaseFirestore.Query;
  if (data.academyId) q = q.where('academyId', '==', data.academyId);
  const snap = await q.get();
  const uids = [
    ...new Set(
      snap.docs
        .map((d) => d.data() as AssignmentDoc)
        .filter((a) => a.end.toMillis() > Date.now())
        .map((a) => a.uid)
    ),
  ];

  await Promise.all(
    uids.map((uid) =>
      notify({
        uid,
        type: 'message',
        title: data.subject as string,
        body: data.body as string,
        link: '/my-schedule',
      })
    )
  );

  await event.data!.ref.update({ status: 'sent', recipientCount: uids.length, sentAt: FieldValue.serverTimestamp() });

  await db().collection('auditLog').add({
    actorUid: data.requestedBy ?? 'system',
    action: 'gjallarhorn.bulk_message',
    targetType: 'bulkMessage',
    targetId: event.params.id,
    summary: `Bulk message "${data.subject}" sent to ${uids.length} instructors`,
    createdAt: FieldValue.serverTimestamp(),
  });
});
