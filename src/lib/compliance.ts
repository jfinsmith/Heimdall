/**
 * Compliance posture (Phase 13) — shared constants + the Data Processing
 * Agreement acknowledgment shown on the Compliance page.
 *
 * IMPORTANT: the DPA text below is a DRAFT TEMPLATE describing how HEIMDALL
 * handles tenant data. It is NOT legal advice and makes NO certification claim
 * (HEIMDALL is not asserting CJIS or FERPA "certification"). Replace the
 * [bracketed placeholders] and have your counsel review before relying on it for
 * an outside tenant. Bump DPA_VERSION whenever the terms materially change so a
 * re-acceptance is recorded.
 */

export const DPA_VERSION = '2026-06-19';

/** Region the app's compute runs in (Cloud Functions). Firestore/Storage data
 *  location is fixed at project creation — verify it's US (see COMPLIANCE.md). */
export const COMPUTE_REGION = 'us-east1';

/** What cadet/staff PII HEIMDALL does and does NOT hold (post-SSN-removal). */
export const PII_INVENTORY: { stored: string[]; notStored: string[] } = {
  stored: [
    'Cadet name, class assignment, and (optional) CJIS student number',
    'Cadet contact details: phone, email, and emergency-contact name & phone',
    'Cadet attendance, demerits/discipline, and end-of-course grades',
    'Staff/instructor name, email, rank, and qualification/certification dates',
    'Academic-action and conduct documents generated for a cadet',
    'Uploaded files in Cloud Storage: bug-report screenshots (which can capture on-screen records) and organization logos',
  ],
  notStored: [
    'Social Security Numbers (removed entirely — the college retains these locally)',
    'Driver-license, passport, or government-ID numbers',
    'Payment-card data (handled solely by Stripe; never touches HEIMDALL)',
    'FBI-sourced Criminal Justice Information (CJI) / criminal-history records',
  ],
};

/** DRAFT Data Processing Agreement clauses (org accepts these on the Compliance page). */
export const DPA_CLAUSES: { heading: string; body: string }[] = [
  {
    heading: 'Roles',
    body: 'Your organization is the data controller for the cadet and staff records it enters. HEIMDALL is the data processor, handling that data only to provide the scheduling, roster, and records service.',
  },
  {
    heading: 'Data residency',
    body: 'Tenant data is stored and processed in the United States. The database (Firestore) and application compute (Cloud Functions) run in the us-east1 region. File storage (Cloud Storage) is configured for a US location [confirm the bucket location before relying on this for a CJIS-bound tenant].',
  },
  {
    heading: 'Tenant isolation',
    body: 'Each organization’s records are logically isolated by an organization identifier enforced in server-side security rules. One organization cannot read or modify another’s data.',
  },
  {
    heading: 'Subprocessors',
    body: 'HEIMDALL relies on Google Cloud / Firebase (hosting, database, authentication, functions, storage) and Stripe (payment processing) as subprocessors. [List any others your deployment adds.]',
  },
  {
    heading: 'Access & portability (FERPA)',
    body: 'You may export your organization’s records at any time from this page. Education records are handled consistent with FERPA; your organization remains responsible for its own FERPA obligations and disclosures.',
  },
  {
    heading: 'Retention & deletion',
    body: 'Records persist until you delete them. Individual cadet/staff records can be removed from the roster and user tools; to purge an entire organization’s data, contact the platform operator. [State your retention period and deletion SLA.]',
  },
  {
    heading: 'Security & breach',
    body: 'Data is encrypted in transit and at rest by the underlying Google Cloud platform; access requires authentication and is constrained by role. [State your breach-notification commitment and timeframe.]',
  },
  {
    heading: 'Not a CJIS attestation',
    body: 'HEIMDALL stores training and personnel records, not FBI CJI, and makes no representation of CJIS certification. If your use introduces CJI, additional controls and a CJIS agreement are your organization’s responsibility.',
  },
];
