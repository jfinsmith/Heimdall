/**
 * HEIMDALL Cloud Functions entry point.
 *
 *   gjallarhorn/  — notification engine: Firestore triggers + scheduled sweeps
 *   admin/        — role/claim callables
 *
 * Deploy: `firebase deploy --only functions` (requires Blaze plan — see README).
 */
import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ region: 'us-east1', maxInstances: 10 });

// Gjallarhorn — event triggers
export { onSignupWritten, onSessionUpdated, onUserCreated, onUserUpdated, onBulkMessageCreated, onCoursePublished, onFeedbackCreated } from './gjallarhorn/triggers';
// Gjallarhorn — personal ICS calendar feed (perpetual subscription URL)
export { calendarFeed } from './gjallarhorn/icsFeed';
// Gjallarhorn — scheduled sweeps (2 Cloud Scheduler jobs, within the 3 free)
export { gjallarhornDailySweep, gjallarhornWeeklyDigest } from './gjallarhorn/sweeps';
// Admin callables
export { setUserRole, bootstrapFirstDirector, createUserAccount, createOrg, academyApproval, sendActivationEmail, setUserSuspension, listAllFeedback, joinOrgByCode, assignUserToOrg, denyUser, listOwnerQueue, getOrgDetail, createOrgAdmin, deleteUnassignedAccount, listAllAuditLog, ownerListOrgs, ownerSwitchOrg, importDefaultCurricula } from './admin/callables';
// Academy roster — encrypted-SSN writers + audited reveal
export { rosterCreateMember, rosterUpdateSsn, rosterRevealSsn } from './admin/roster';
