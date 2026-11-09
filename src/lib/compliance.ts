/**
 * Compliance posture — shared constants + the Data Processing Agreement an
 * organization's administrator accepts on the Compliance page.
 *
 * The DPA below is the agreement in force, not a template. Every statement in
 * it describes how HEIMDALL actually behaves (regions verified against the live
 * project on 2026-11-09; retention matches the daily sweep and the account
 * purge) or is a commitment the operator makes. It makes NO certification claim
 * (HEIMDALL does not assert CJIS or FERPA "certification").
 *
 * Changing the text: bump DPA_VERSION here AND add the new version to
 * KNOWN_DPA_VERSIONS in functions/src/admin/callables.ts (acceptOrgDpa), then
 * deploy functions — organizations are asked to accept the updated agreement.
 */

export const DPA_VERSION = '2026-11-09';

/** Google Cloud region for ALL tenant data and compute: Cloud Functions,
 *  Firestore and the Cloud Storage bucket (each verified us-east1 — see
 *  COMPLIANCE.md). Database and bucket locations are fixed at creation. */
export const COMPUTE_REGION = 'us-east1';

/** What cadet/staff PII HEIMDALL does and does NOT hold (post-SSN-removal). */
export const PII_INVENTORY: { stored: string[]; notStored: string[] } = {
  stored: [
    'Cadet name, class assignment, date of birth, and (optional) CJIS student number',
    'Cadet contact details: phone, email, and emergency-contact name & phone',
    'Cadet attendance, demerits/discipline, and end-of-course grades',
    'Return-to-training tracking for cadets: the reason, blocks still owed, and — for injuries — the injury date, follow-up dates, and work restrictions your staff enter',
    'Post-graduation assignment plans (where each new hire is working before New Member Training)',
    'Staff/instructor name, email, phone, date of birth, rank, and qualification/certification dates',
    'Academic-action and conduct documents generated for a cadet',
    'Uploaded files in Cloud Storage: instructor certification-card photos, bug-report screenshots (which can capture on-screen records), room diagrams, and organization logos',
  ],
  notStored: [
    'Social Security Numbers (never collected — your organization keeps these in its own records)',
    'Driver-license, passport, or government-ID numbers',
    'Payment-card data (handled solely by Stripe; never touches HEIMDALL)',
    'FBI-sourced Criminal Justice Information (CJI) / criminal-history records',
  ],
};

/** Data Processing Agreement clauses (an org administrator accepts these on the Compliance page). */
export const DPA_CLAUSES: { heading: string; body: string }[] = [
  {
    heading: 'Roles',
    body: 'Your organization is the data controller for the cadet and staff records it enters. HEIMDALL is the data processor: it handles that data only to provide the scheduling, roster, and records service, on the instructions your administrators and staff give through the Service. HEIMDALL does not sell this data or use it for advertising.',
  },
  {
    heading: 'Data residency',
    body: 'Your organization’s data is stored and processed in the United States. The database (Firestore), file storage (Cloud Storage), and application compute (Cloud Functions) all run in Google Cloud’s us-east1 region. Email is delivered through our email provider’s United States region.',
  },
  {
    heading: 'Tenant isolation',
    body: 'Each organization’s records are logically isolated by an organization identifier enforced in server-side security rules, and those rules are checked by automated tests before any change to them is released. One organization cannot read or modify another’s data.',
  },
  {
    heading: 'Subprocessors',
    body: 'HEIMDALL uses Google Cloud / Firebase (hosting, database, authentication, server functions, file storage), Resend (delivery of notification and account email), and Stripe (subscription payments — it receives billing details only, never cadet or training records). If a member chooses to sign in with Google or Microsoft, that provider authenticates them. Before adding a subprocessor that handles your organization’s records, we will update this list and ask you to accept the revised agreement.',
  },
  {
    heading: 'Operator access',
    body: 'HEIMDALL’s operator accesses your organization’s data only as needed to provide support you request, to maintain and secure the Service, or to comply with law.',
  },
  {
    heading: 'Access & portability (FERPA)',
    body: 'You may export your organization’s records at any time from this page. HEIMDALL acts as your service provider for the education records you enter and uses them only to provide the Service; your organization remains responsible for its own FERPA obligations and disclosures.',
  },
  {
    heading: 'Retention & deletion',
    body: 'Your records are kept for as long as your organization uses the Service, or until your staff delete them: individual cadet records are removed from a class roster, member accounts under Users & Roles, and deleting a class removes its roster, grades, attendance, and filed documents. Copies of sent email are deleted after 30 days. To delete all of your organization’s data, a top administrator sends a written request to support@heimdallscheduling.com; we delete it from production systems within 30 days and confirm in writing. If your organization stops using the Service, an export is available on request for 30 days, after which the data is deleted.',
  },
  {
    heading: 'Security & breach notification',
    body: 'Data is encrypted in transit and at rest by the Google Cloud platform. Access requires authentication and is limited by role; administrative actions are validated on the server and recorded in an audit log. If we confirm a security breach affecting your organization’s data, we will notify your organization’s administrators by email without undue delay and no later than 72 hours after confirming it, tell you what was affected and what we are doing about it, and cooperate with your own notification obligations.',
  },
  {
    heading: 'Not a CJIS attestation',
    body: 'HEIMDALL stores training and personnel records, not FBI Criminal Justice Information (CJI), and makes no representation of CJIS, FERPA, or other certification. If your use introduces CJI, additional controls and a CJIS agreement are your organization’s responsibility.',
  },
  {
    heading: 'Changes to this agreement',
    body: 'If these terms change materially, the version date changes and your organization is asked to accept the updated agreement on this page. The version your organization accepted, with the date and the administrator’s name, is kept on record.',
  },
];
