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
import { getAuth } from 'firebase-admin/auth';
import {
  escalateToCommand,
  getSettings,
  notify,
  notifyAdmins,
  notifyCoordinators,
  sessionDetails,
  sessionIcs,
} from './notify';
import { renderEmail, escapeHtml } from './templates';
import type { AssignmentDoc, SessionDoc, SignupDoc, UserDoc } from '../types';

const db = () => getFirestore();
const LEAD_ESCALATION_DAYS = 7; // lead withdrawal inside this window escalates to command

async function getSession(sessionId: string): Promise<SessionDoc | null> {
  const snap = await db().doc(`sessions/${sessionId}`).get();
  return snap.exists ? (snap.data() as SessionDoc) : null;
}

/**
 * Promote the oldest waitlisted candidate into a freed slot. Runs on the Admin
 * SDK, which bypasses the client rules that (deliberately) forbid a user from
 * writing another user's signup/assignment — so promotion works no matter who
 * withdrew. Re-validates session status, slot capacity, and the candidate
 * inside the transaction. Returns true if someone was promoted; setting their
 * signup to 'confirmed' re-fires onSignupWritten, which emails them.
 */
async function promoteFromWaitlist(sessionId: string, slotId: string): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const sessionRef = db().doc(`sessions/${sessionId}`);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) return false;
    const session = sessionSnap.data() as SessionDoc;
    if (session.status !== 'open' && session.status !== 'fully_staffed') return false; // closed session
    const slot = session.roleSlots.find((s) => s.slotId === slotId);
    if (!slot || slot.filledBy.length >= slot.count) return false; // no room

    // Oldest waitlisted sign-up for this slot (Admin transactions may query).
    const waitlistSnap = await tx.get(
      db().collection(`sessions/${sessionId}/signups`).where('status', '==', 'waitlist').orderBy('signedUpAt')
    );
    const candidate = waitlistSnap.docs
      .map((d) => d.data() as SignupDoc)
      .find((w) => w.slotId === slotId && !slot.filledBy.includes(w.uid));
    if (!candidate) return false;

    const newSlots = session.roleSlots.map((s) =>
      s.slotId === slotId ? { ...s, filledBy: [...s.filledBy, candidate.uid] } : s
    );
    const full = newSlots.every((s) => s.filledBy.length >= s.count);

    tx.update(db().doc(`sessions/${sessionId}/signups/${candidate.uid}`), { status: 'confirmed' });
    tx.set(db().doc(`assignments/${sessionId}_${candidate.uid}`), {
      uid: candidate.uid,
      sessionId,
      // Stamp the tenant (Admin SDK bypasses the rule that would block an org-less
      // assignment) — otherwise the auto-promoted instructor's assignment is
      // org-less and silently filtered out of every schedule view.
      orgId: session.orgId,
      academyId: session.academyId,
      role: candidate.role,
      courseName: session.courseName,
      location: session.location,
      room: session.room,
      start: session.start,
      end: session.end,
      status: 'confirmed',
      reminderSent: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(sessionRef, {
      roleSlots: newSlots,
      status: full ? 'fully_staffed' : 'open',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

// ── Sign-up lifecycle ───────────────────────────────────────────────────────
export const onSignupWritten = onDocumentWritten('sessions/{sessionId}/signups/{uid}', async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as SignupDoc) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as SignupDoc) : null;
  if (!after) return;
  const { sessionId, uid } = event.params;
  const session = await getSession(sessionId);
  if (!session) return;
  const settings = await getSettings(session.orgId);

  const becameConfirmed = after.status === 'confirmed' && before?.status !== 'confirmed';
  const becameWithdrawn = after.status === 'withdrawn' && before?.status !== 'withdrawn';

  if (becameConfirmed) {
    // 1) Confirmation to the instructor, with session details + .ics
    const details = sessionDetails(session);
    await notify({
      uid,
      dedupeKey: `${event.id}_confirm`,
      type: 'signup_confirmed',
      title: `Confirmed: ${session.title || session.courseName}`,
      body: `You are confirmed as ${after.role.replace('_', ' ')}.`,
      link: `/my-schedule`,
      emailContent: renderEmail({
        subject: `[HEIMDALL] Confirmed — ${session.title || session.courseName}`,
        heading: 'Assignment confirmed',
        bodyHtml: `<p>${escapeHtml(after.displayName)}, you are confirmed as <strong>${escapeHtml(after.role.replace('_', ' '))}</strong>.</p>${details.html}`,
        bodyText: `${after.displayName}, you are confirmed as ${after.role.replace('_', ' ')}.\n\n${details.text}`,
        orgName: settings?.orgName,
        logoUrl: settings?.logoUrl,
      }),
      attachments: [{ filename: 'session.ics', content: sessionIcs(sessionId, session) }],
    });
  }

  if (becameWithdrawn) {
    // Auto-promote the next waitlisted candidate for the vacated slot (Admin
    // SDK — the client can't, by design). If the slot gets re-filled it isn't
    // really "re-opened", so skip the coordinator alert and lead escalation.
    const promoted = await promoteFromWaitlist(sessionId, after.slotId);
    if (!promoted) {
      // 2) Withdrawal / slot re-opened → coordinators
      await notifyCoordinators(session.academyId, {
        dedupeKey: `${event.id}_reopen`,
        type: 'slot_reopened',
        title: `Slot re-opened: ${session.title || session.courseName}`,
        body: `${after.displayName} withdrew from the ${after.role.replace('_', ' ')} slot on ${session.start
          .toDate()
          .toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.`,
        link: `/cadre/staffing`,
      });

      // 3) Lead withdrawal close to the session date → escalate up the chain
      const daysOut = (session.start.toMillis() - Date.now()) / 864e5;
      const escWindow = settings?.escalationWindowDays ?? LEAD_ESCALATION_DAYS;
      if (after.role === 'lead' && daysOut <= escWindow && daysOut > 0) {
        await escalateToCommand({
          dedupeKey: `${event.id}_leadesc`,
          type: 'lead_withdrawal_escalation',
          title: `ESCALATION — lead withdrew ${Math.ceil(daysOut)} days out`,
          body: `${after.displayName} withdrew as LEAD for "${session.title || session.courseName}" on ${session.start
            .toDate()
            .toLocaleString('en-US', { timeZone: 'America/New_York' })}. Verify the lead slot is still covered.`,
          link: `/cadre/staffing`,
        }, session.orgId);
      }
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
      dedupeKey: `${event.id}_staffed`,
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

  const settings = await getSettings(after.orgId);
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
            : {
                start: after.start,
                end: after.end,
                room: after.room,
                location: after.location,
                courseName: after.courseName,
                // Only re-arm the reminder when the TIME moved — a room-only
                // edit shouldn't re-send reminders that already went out.
                ...(timeChanged ? { reminderSent: false } : {}),
              },
          { merge: true }
        );
      await notify({
        uid: su.uid,
        dedupeKey: `${event.id}_sched_${su.uid}`,
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
          bodyHtml: `<p>${escapeHtml(su.displayName)}, your assigned session has been <strong>${what}</strong>.</p>${details.html}`,
          bodyText: `${su.displayName}, your assigned session has been ${what}.\n\n${details.text}`,
          orgName: settings?.orgName,
          logoUrl: settings?.logoUrl,
        }),
      });
    })
  );
});

/**
 * Find the tenant that claims an email's domain via its per-org
 * allowedEmailDomains (settings/{orgId}). Returns the orgId only on an
 * UNAMBIGUOUS single match — 0 matches (or 2+, a misconfiguration) leave the
 * user unassigned (→ the awaiting-org screen). A blank domain list means the
 * org opts out of domain auto-join (admin-add only), preserving prior behavior.
 */
async function findOrgIdByEmailDomain(email: string): Promise<string | null> {
  const domain = (email.split('@')[1] ?? '').toLowerCase().trim();
  if (!domain) return null;
  const snap = await db().collection('settings').get();
  const matches = snap.docs.filter((d) => {
    if (d.id === 'global') return false; // legacy singleton, not a tenant
    const domains = d.data().allowedEmailDomains;
    return Array.isArray(domains) && domains.map((x: string) => String(x).toLowerCase().trim()).includes(domain);
  });
  return matches.length === 1 ? matches[0].id : null;
}

// ── New self-registered account → auto-assign tenant by domain, notify command ─
export const onUserCreated = onDocumentCreated('users/{uid}', async (event) => {
  const data = event.data?.data() as UserDoc | undefined;
  // Admin-created accounts come in as 'active' (and email their own credentials);
  // only self-registrations land as 'pending' and need command's attention.
  if (!data || data.status !== 'pending') return;
  const uid = event.params.uid;

  // Phase 6 — multi-tenant sign-in: route the new account to its org by email
  // domain. A match stamps the orgId claim + doc (no role yet — admin approval
  // sets that); the AuthContext force-refresh then moves them off the
  // awaiting-org screen into their org's pending queue.
  //
  // Auto-join is gated on a VERIFIED email: Google SSO is always verified, but
  // email/password sign-ups are NOT — so a spoofed someone@tenant.edu can't drop
  // a forged identity into a real org's approval queue. Unverified addresses fall
  // through to the owner-notify path (manual assignment). Wrapped so an assign
  // failure can never swallow the notification below.
  let orgId = data.orgId;
  if (!orgId && data.email) {
    try {
      const userRecord = await getAuth().getUser(uid).catch(() => null);
      if (userRecord?.emailVerified) {
        const matched = await findOrgIdByEmailDomain(data.email);
        if (matched) {
          await getAuth().setCustomUserClaims(uid, { ...(userRecord.customClaims ?? {}), orgId: matched });
          await db().doc(`users/${uid}`).set({ orgId: matched, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          orgId = matched;
        }
      }
    } catch (e) {
      console.error('onUserCreated: domain auto-assign failed; falling back to owner notify', e);
    }
  }

  if (orgId) {
    // Matched a tenant → its command reviews the pending account.
    await notifyAdmins({
      dedupeKey: `${event.id}_newacct`,
      type: 'new_account_pending',
      title: 'New account request',
      body: `${data.displayName || data.email} requested a HEIMDALL account and is awaiting approval.`,
      link: '/admin/users',
    }, orgId);
  } else {
    // No tenant matched — alert the PLATFORM OWNER(s) only (not every org's
    // command), who can assign the account to an org.
    const owners = await db().collection('users').where('platformOwner', '==', true).get();
    await Promise.all(
      owners.docs.map((o) =>
        notify({
          uid: o.id,
          dedupeKey: `${event.id}_unassigned_${o.id}`,
          type: 'new_account_pending',
          title: 'Unassigned account request',
          body: `${data.displayName || data.email} (${data.email}) registered but matched no organization. Assign them to a tenant to continue.`,
          link: '/owner',
        })
      )
    );
  }
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
      dedupeKey: `${event.id}_approved`,
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
      dedupeKey: `${event.id}_qual_${q.key}`,
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
  // The coordinator chose who to notify when they opened sign-ups (Open sign-ups
  // modal). Default to everyone eligible for back-compat with older events.
  const target = (data.target ?? { mode: 'all' }) as
    | { mode: 'all' }
    | { mode: 'qualification'; qualificationKey: string }
    | { mode: 'users'; uids: string[] };

  // Scan the course's open sessions for the earliest start (email copy) and,
  // for the 'all' target, the union of qualifications on unfilled slots.
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
  const academyOrgId = academy.exists ? (academy.data()!.orgId as string | undefined) : undefined;

  // Resolve recipients for the email blast (the course is visible to all eligible
  // instructors regardless — this only controls who gets pushed an email).
  let recipientIds: string[];
  if (target.mode === 'users') {
    recipientIds = target.uids ?? [];
  } else {
    // Scope to the academy's own tenant so a pooled DB doesn't notify other orgs' instructors.
    let uq: FirebaseFirestore.Query = db().collection('users').where('status', '==', 'active');
    if (academyOrgId) uq = uq.where('orgId', '==', academyOrgId);
    const users = await uq.get();
    recipientIds = users.docs
      .filter((d) => {
        const u = d.data() as UserDoc;
        if (target.mode === 'qualification') {
          return (u.verifiedQualKeys ?? []).includes(target.qualificationKey);
        }
        return anyUnrestricted || (u.verifiedQualKeys ?? []).some((k) => slotQuals.has(k));
      })
      .map((d) => d.id);
  }

  const firstDay = earliest
    ? earliest.toDate().toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })
    : '';
  await Promise.all(
    recipientIds.map((uid) =>
      notify({
        uid,
        dedupeKey: `${event.id}_${uid}`,
        type: 'course_published',
        title: `Sign-ups open: ${academyLabel} ${courseLabel}`,
        body: `${courseLabel} (${sessionCount} session${sessionCount === 1 ? '' : 's'}${firstDay ? `, starting ${firstDay}` : ''}) is now open for instructor sign-up in ${academyLabel}.`,
        link: '/open-sessions',
      })
    )
  );
});

// ── Bug / feature report filed → notify command for triage ────────────────
export const onFeedbackCreated = onDocumentCreated('feedbackReports/{id}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const kind = data.kind === 'feature' ? 'Feature request' : 'Bug report';
  const who = data.submittedByName || 'A member';
  const sev = data.severity ? ` · ${data.severity}` : '';
  // Bug/feature triage is platform-owner-only now → notify the owner(s), not org admins.
  const owners = await db().collection('users').where('platformOwner', '==', true).get();
  await Promise.all(
    owners.docs.map((o) =>
      notify({
        uid: o.id,
        dedupeKey: `${event.id}_${o.id}`,
        type: 'feedback_submitted',
        title: `${kind}: ${data.title ?? ''}`.trim(),
        body: `${who} submitted a ${kind.toLowerCase()}${sev}${data.area ? ` in ${data.area}` : ''}.\n\n${data.description ?? ''}`,
        link: '/owner/feedback',
      })
    )
  );
});

// ── Bulk message fan-out (from the Staffing Board) ─────────────────────────
export const onBulkMessageCreated = onDocumentCreated('bulkMessages/{id}', async (event) => {
  const data = event.data?.data();
  if (!data || data.status !== 'pending') return;

  // Claim the message transactionally so an at-least-once retry can't re-fan-out
  // or duplicate the audit entry (the event snapshot stays 'pending' on retry).
  const claimed = await db().runTransaction(async (tx) => {
    const fresh = await tx.get(event.data!.ref);
    if (!fresh.exists || fresh.data()!.status !== 'pending') return false;
    tx.update(event.data!.ref, { status: 'sending' });
    return true;
  });
  if (!claimed) return;

  // Audience: instructors with upcoming confirmed assignments (optionally per
  // academy). Scoped to the sender's org so an "all academies" blast never
  // reaches another tenant's instructors (dormant until orgId is backfilled).
  let q = db().collection('assignments').where('status', '==', 'confirmed') as FirebaseFirestore.Query;
  if (data.orgId) q = q.where('orgId', '==', data.orgId);
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
        dedupeKey: `${event.id}_${uid}`,
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
