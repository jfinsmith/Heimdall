/**
 * HEIMDALL Cloud Functions entry point.
 *
 *   gjallarhorn/  — notification engine: Firestore triggers, scheduled sweeps,
 *                   the schedule-change quiet-period flush, the mail queue
 *                   sender and the personal ICS feed
 *   sessions/     — server-owned sign-up / withdraw / reservation callables
 *   rooms/        — ad-hoc room reservation callables
 *   admin/        — account, role/claim, org and owner-console callables;
 *                   roster member creation; the daily org-less account purge
 *   profile/      — code-verified secondary notification email
 *   billing/      — Stripe checkout, billing portal and webhook
 *   public/       — the public class portal (the only unauthenticated read)
 *
 * Deploy: `firebase deploy --only functions` — by hand; the push-to-main CI
 * deploys hosting and rules only. Removing an export here makes the next deploy
 * offer to delete that function in production, and renaming one is a delete
 * plus a create (live clients break until hosting redeploys) — so don't rename.
 *
 * Cloud Scheduler jobs: FOUR — gjallarhornDailySweep, gjallarhornWeeklyDigest,
 * accountPurgeDaily and gjallarhornChangeFlush (one more than the free three).
 */
import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ region: 'us-east1', maxInstances: 10 });

// Gjallarhorn — event triggers
export { onSignupWritten, onSessionUpdated, onUserCreated, onUserUpdated, onBulkMessageCreated, onCoursePublished, onFeedbackCreated } from './gjallarhorn/triggers';
export { submitSignup, withdrawSignup, checkInstructorConflict, confirmReservation } from './sessions/signup';
export { saveRoomReservation, deleteRoomReservation } from './rooms/reservations';
// Gjallarhorn — personal ICS calendar feed (perpetual subscription URL)
export { calendarFeed } from './gjallarhorn/icsFeed';
// Gjallarhorn — scheduled sweeps (daily + weekly: 2 of the 4 Cloud Scheduler jobs)
export { gjallarhornDailySweep, gjallarhornWeeklyDigest } from './gjallarhorn/sweeps';
// Schedule-change quiet period — every-2-minute flush (Cloud Scheduler job)
export { gjallarhornChangeFlush } from './gjallarhorn/changeQueue';
// Outgoing mail — sends each mailQueue doc
export { sendQueuedEmail } from './gjallarhorn/mailer';
// Daily purge of org-less accounts (Cloud Scheduler job)
export { accountPurgeDaily } from './admin/purge';
// Admin callables
export { setUserRole, createUserAccount, createOrg, academyApproval, sendActivationEmail, setUserSuspension, setUserActive, listAllFeedback, joinOrgByCode, assignUserToOrg, denyUser, listOwnerQueue, getOrgDetail, setOrgComplimentary, setOrgSuspension, createOrgAdmin, deleteUnassignedAccount, listAllAuditLog, ownerListOrgs, ownerSwitchOrg, acceptOrgDpa, adminUpdateUser, setFeedbackStatus, adminDeleteAccount } from './admin/callables';
// Academy roster — member creation (no SSN stored; college holds SSNs locally)
export { rosterCreateMember } from './admin/roster';
// Profile — code-verified secondary notification email
export { requestNotificationEmail, confirmNotificationEmail, clearNotificationEmail } from './profile/notificationEmail';
// Billing (Phase 14) — Stripe subscriptions (checkout, portal, webhook)
export { createCheckoutSession, createBillingPortalSession, stripeWebhook } from './billing/stripe';
// Public class portal — the only unauthenticated read surface (token link + tiered passwords)
export { getPublicClassPortal } from './public/portal';
// Read-only Viewer accounts — the only data source for role 'viewer' (no direct DB access).
export { getViewerStaffing } from './viewer/staffing';
