/**
 * HEIMDALL shared TypeScript interfaces — mirrors the Firestore data model.
 * Keep in sync with functions/src/types.ts (the Cloud Functions copy) and
 * firestore.rules. All date fields are Firestore Timestamps.
 */
import type { Timestamp } from 'firebase/firestore';

// ── Roles & chain of command ───────────────────────────────────────────────
// Instructor → Coordinator → Sergeant → Lieutenant → Director (Captain)
// Role KEYS are stable (claims + firestore.rules depend on them); display
// labels are editable per-org via GlobalSettings.roleLabels. 'guest' is a
// read-only rank (not staff, not admin — excluded from STAFF/ADMIN below).
export type Role = 'director' | 'lieutenant' | 'sergeant' | 'coordinator' | 'instructor' | 'guest';

/** Roles that can build schedules / approve sign-ups ("coordinator+"). */
export const STAFF_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator'];
/** Roles that can manage users and org settings ("command"). */
export const ADMIN_ROLES: Role[] = ['director', 'lieutenant'];

export type UserStatus = 'pending' | 'active' | 'inactive' | 'suspended';

export type QualificationKey =
  | 'general'
  | 'handgun'
  | 'carbine'
  | 'dt'            // Defensive Tactics / CMS
  | 'vehicle_ops'
  | 'first_aid'
  | 'role_player';

export const QUALIFICATION_LABELS: Record<QualificationKey, string> = {
  general: 'General Instructor',
  handgun: 'Handgun Instructor',
  carbine: 'Carbine Instructor',
  dt: 'Defensive Tactics / CMS Instructor',
  vehicle_ops: 'Vehicle Operations Instructor',
  first_aid: 'First Aid / CPR Instructor',
  role_player: 'Role Player',
};

/**
 * Role Player is exempt from certification dating — it's a dateless flag anyone
 * may self-claim to be called out for role-player help. Every OTHER qualification
 * is an FDLE instructor cert that follows the single General-Instructor
 * expiration on the user (UserDoc.instructorCertExpires).
 */
export const isInstructorQual = (key: QualificationKey): boolean => key !== 'role_player';
export const INSTRUCTOR_QUAL_KEYS: QualificationKey[] = (
  Object.keys(QUALIFICATION_LABELS) as QualificationKey[]
).filter(isInstructorQual);

/** True while the member's single FDLE instructor cert is on file and unexpired. */
export function instructorCertActive(
  user: { instructorCertExpires?: Timestamp },
  now: Date = new Date()
): boolean {
  return !!user.instructorCertExpires && user.instructorCertExpires.toDate() >= now;
}

/**
 * Verified qualifications that currently COUNT for sign-ups: a qual must be
 * verified, and — for instructor certs — the shared FDLE expiration must not
 * have lapsed. Role Player never expires (but still must be verified).
 */
export function activeVerifiedQualKeys(
  user: { qualifications?: Qualification[]; instructorCertExpires?: Timestamp },
  now: Date = new Date()
): QualificationKey[] {
  const certOk = instructorCertActive(user, now);
  return (user.qualifications ?? [])
    .filter((q) => q.verified && (certOk || !isInstructorQual(q.key)))
    .map((q) => q.key);
}

export interface Qualification {
  key: QualificationKey;
  label: string;
  /** Approval-gated: claimed by the user, verified by a supervisor/coordinator. */
  verified: boolean;
  verifiedBy?: string; // uid
  /** @deprecated Per-qual dates are replaced by the single UserDoc.instructorCertExpires. */
  attendedOn?: Timestamp | null;
}

export interface NotificationPrefs {
  email: boolean;
  /** Hours before a session start to send the Gjallarhorn reminder. */
  reminderLeadHours: number;
  digest: boolean;
}

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL?: string;
  phone?: string;
  rank?: string;
  agency?: string;
  role: Role;
  status: UserStatus;
  qualifications: Qualification[];
  /**
   * Authoritative list of verified qualification keys, maintained ONLY by
   * staff (admin verify action). Security rules forbid self-edits to this
   * field, which is what actually gates restricted slots — the `verified`
   * flag inside `qualifications` is display metadata (rules cannot iterate
   * arrays of maps to protect it).
   */
  verifiedQualKeys: QualificationKey[];
  /**
   * Single FDLE instructor-cert expiration shared by ALL of this user's
   * instructor qualifications. Always March 31 of the cert year, renewed on a
   * 4-year cycle (tied to their General Instructor course). Optional when a user
   * self-claims; required when an admin verifies an instructor qual. Role Player
   * is unaffected.
   */
  instructorCertExpires?: Timestamp;
  notificationPrefs: NotificationPrefs;
  /** Random token for the personal ICS calendar-feed URL (user-generated). */
  icsToken?: string;
  /**
   * Set true when an admin creates the account with a temporary password.
   * The app forces a password change on first sign-in and clears this flag
   * once the user picks their own password.
   */
  mustChangePassword?: boolean;
  /** Set when status==='suspended': the reason shown to the member + leadership. */
  suspensionReason?: string;
  suspendedAt?: Timestamp;
  suspendedBy?: string;
  /** Tenant this user belongs to (orgs/{orgId}). Set when provisioned/backfilled. */
  orgId?: string;
  /** Product owner — manages orgs/billing + cross-org feedback; NOT a tenant role. */
  platformOwner?: boolean;
  /** Platform owner only: the owner's REAL home org + rank (e.g. phsc / lieutenant),
   *  preserved across cross-org "switch" so impersonation is always reversible.
   *  While switched into another org, orgId/role hold the active (impersonated)
   *  values and these hold the canonical home identity. */
  homeOrgId?: string;
  homeRole?: Role;
  /** Set when an org admin DENIES a pending join — the account is bounced back to
   *  the platform owner's queue (orgId cleared); records which org turned them away. */
  deniedFromOrgId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Gjallarhorn email automations (admin-toggleable) ───────────────────────
/** Every automated email Gjallarhorn can send. Keys match NotificationType. */
export const EMAIL_AUTOMATIONS = [
  { key: 'signup_confirmed', label: 'Sign-up confirmation', description: 'Emails the instructor (with calendar invite) when they sign up for a slot.' },
  { key: 'slot_reopened', label: 'Withdrawal / slot re-opened', description: 'Emails the academy coordinators when an instructor withdraws.' },
  { key: 'session_fully_staffed', label: 'Session fully staffed', description: 'Emails coordinators when the last required slot fills.' },
  { key: 'lead_withdrawal_escalation', label: 'Lead withdrawal escalation', description: 'Emails command when a lead withdraws inside the escalation window.' },
  { key: 'schedule_change', label: 'Schedule change', description: 'Emails signed-up instructors when a session is moved, re-roomed, or cancelled.' },
  { key: 'qualification_approved', label: 'Qualification verified', description: 'Emails the instructor when a coordinator verifies a qualification.' },
  { key: 'course_published', label: 'Course opened for sign-up', description: 'Emails eligible instructors when coordinators open a course’s sessions for sign-up.' },
  { key: 'account_approved', label: 'Account approved', description: 'Emails a new user when their account is activated.' },
  { key: 'new_account_pending', label: 'New account request', description: 'Emails command when someone self-registers and is waiting for approval.' },
  { key: 'account_suspended', label: 'Account suspended', description: 'Emails a member when an admin suspends their account, with the reason.' },
  { key: 'account_reinstated', label: 'Account reinstated', description: 'Emails a member when their suspension is lifted and access is restored.' },
  { key: 'approval_request', label: 'Schedule approval — your turn', description: 'Emails the next approver (sergeant → lieutenant → captain) when a class is awaiting their sign-off.' },
  { key: 'approval_update', label: 'Schedule approval — decision', description: 'Emails the coordinator when their class is fully approved or sent back with changes.' },
  { key: 'reminder', label: 'Assignment reminders', description: 'Daily sweep: emails instructors ahead of their upcoming assignments.' },
  { key: 'understaffing_alert', label: 'Understaffing alerts', description: 'Daily sweep: emails coordinators + command about unfilled slots inside the alert window.' },
  { key: 'digest', label: 'Weekly digest', description: 'Monday summary of staffing health for coordinators and command.' },
  { key: 'message', label: 'Bulk messages', description: 'Manual broadcasts sent from the Staffing Board.' },
  { key: 'feedback_submitted', label: 'Bug / feature report', description: 'Emails command when a member submits a bug report or feature request.' },
] as const;

export type EmailAutomationKey = (typeof EMAIL_AUTOMATIONS)[number]['key'];

// ── Org settings (settings/global singleton) ───────────────────────────────
/**
 * A tenant (college/agency). Doc id == orgId. Isolation is enforced by an orgId
 * custom-claim match in security rules (added at the Phase-5 cutover); the id is
 * non-enumerable defense-in-depth, not the security boundary.
 */
export interface OrgDoc {
  orgId: string;          // == doc id, e.g. 'phsc' or 'phsc-7f3a9c'
  shortCode: string;      // human prefix, e.g. 'phsc'
  legalName: string;      // e.g. 'Pasco-Hernando State College'
  status: 'active' | 'suspended';
  /**
   * Billing (Phase 14). All fields are SERVER-managed (Stripe webhook via the
   * Admin SDK; orgs are `allow write: if false` for clients) so a tenant can
   * never forge its own subscription state.
   *
   * `billingEnabled` is the gate switch: when false/absent the org is treated as
   * UNRESTRICTED (the founding PHSC tenant + any org created before we turned on
   * commercialization). Only when it's true does `subscriptionStatus` actually
   * gate the org. This keeps every existing tenant non-regressing.
   */
  billingEnabled?: boolean;
  plan?: string;
  /** Mirrors Stripe's Subscription.Status verbatim (written by the webhook). */
  subscriptionStatus?:
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused'
    | 'unpaid';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** Current paid period end (epoch ms) — used for a grace window on past_due. */
  currentPeriodEnd?: number;
  /**
   * Compliance (Phase 13). All SERVER-managed (orgs is `allow write: if false`).
   * `dataRegion` records where the tenant's data physically lives (US for CJIS);
   * the DPA fields record the org admin's acceptance of the Data Processing
   * Agreement — the per-org compliance gate before onboarding an outside tenant.
   */
  dataRegion?: string;
  dpaAcceptedAt?: Timestamp;
  dpaAcceptedBy?: string;
  dpaAcceptedByName?: string;
  dpaVersion?: string;
  createdAt: Timestamp;
  createdBy?: string;
}

export interface GlobalSettings {
  orgName: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl?: string;
  /**
   * Document jurisdiction for academic-action letters. 'FL' renders the
   * Florida FDLE/CJSTC statutory clauses (F.A.C. rule citations); 'neutral'
   * (default for non-founding orgs) renders state-agnostic wording. The founding
   * PHSC org defaults to 'FL' so its official memos are unchanged.
   */
  jurisdiction?: 'FL' | 'neutral';
  /** Optional tagline under the org name in the letterhead (non-PHSC orgs). */
  letterheadTagline?: string;
  /** Optional address / contact lines printed under the document header (e.g.
   *  campus addresses). One entry per line. Overridable per curriculum. */
  letterheadAddressLines?: string[];
  /**
   * Per-org join code (a shared "site password"). A signed-up user who enters it
   * on the awaiting-org screen is routed into THIS org's pending queue (still
   * admin-approved). Blank = no code join. Set by an org admin in Org Settings.
   */
  siteCode?: string;
  /** Per-org editable display labels for ranks (presentation only — keys/rules unchanged). */
  roleLabels?: Partial<Record<Role, string>>;
  allowedEmailDomains: string[]; // empty = allow any
  reminderDefaultLeadHours: number;       // Gjallarhorn
  understaffingAlertDays: number;         // alert window for unfilled required slots
  escalationRecipients: string[];         // uids or emails for command alerts
  weeklyDigestEnabled: boolean;
  /** Holiday keys turned OFF for this org's calendars (e.g. Juneteenth). */
  disabledHolidays?: string[];
  /** Holiday keys the agency observes as paid (grant holiday-pay hours). */
  observedHolidays?: string[];
  /** Hours of holiday pay credited for an observed holiday (paid day off). Default 8.5. */
  holidayPayHours?: number;
  /** Required hours per bi-weekly pay period before overtime (PSO default 85). */
  payPeriodTargetHours?: number;
  /** Master kill-switch for ALL outbound email (in-app notifications still fire). */
  emailMasterEnabled: boolean;
  /** Per-automation email toggles; missing key = enabled. */
  emailAutomations: Partial<Record<EmailAutomationKey, boolean>>;
  /**
   * Per-automation recipient-role filter. If a key maps to a non-empty list,
   * only recipients whose role is in the list receive that email (the in-app
   * bell still fires for everyone). Missing/empty = every role receives it.
   */
  emailAutomationRoles?: Partial<Record<EmailAutomationKey, Role[]>>;
  /** Lead-withdrawal escalation window (days before a session) — default 7. */
  escalationWindowDays?: number;
}

/** Who a "course opened for sign-up" announcement email targets. */
export type CoursePublishTarget =
  | { mode: 'all' }
  | { mode: 'qualification'; qualificationKey: QualificationKey }
  | { mode: 'users'; uids: string[] };

// ── Curriculum ─────────────────────────────────────────────────────────────
export type Discipline = 'law_enforcement' | 'corrections' | 'cross_over' | 'all';

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  law_enforcement: 'Law Enforcement',
  corrections: 'Corrections',
  cross_over: 'Cross-Over',
  all: 'All Disciplines',
};

export type SlotRole = 'lead' | 'assistant' | 'role_player' | 'safety_officer' | 'coordinator';

export const SLOT_ROLE_LABELS: Record<SlotRole, string> = {
  lead: 'Lead Instructor',
  assistant: 'Assistant Instructor',
  role_player: 'Role Player',
  safety_officer: 'Safety Officer',
  // Coordinator slots are pre-assigned in the builder (no open registration) —
  // the academy's coordinator simply owns that block.
  coordinator: 'Coordinator (assigned)',
};

/**
 * Roles a coordinator may pick for a NEW slot. 'safety_officer' is retired: it
 * stays in SlotRole / SLOT_ROLE_LABELS so legacy sessions that still carry it
 * render correctly, but it's no longer offered as a choice or applied from
 * catalog defaults.
 */
export const SELECTABLE_SLOT_ROLES: SlotRole[] = ['lead', 'assistant', 'role_player', 'coordinator'];

export interface DefaultRoleSlot {
  role: SlotRole;
  count: number;
  requiredQualificationKey?: QualificationKey;
}

export interface CourseDoc {
  name: string;
  fdleCourseCode: string;
  /** Category tag: 'all' (cross-discipline) or a program tag like 'argus' that
   * scopes the course to that program's academies in the session picker. */
  discipline: Discipline | string;
  defaultHours: number;
  highLiability: boolean;
  description: string;
  defaultRoleSlots: DefaultRoleSlot[];
  leadRequiredQualificationKey?: QualificationKey;
}

// ── Academies (cohorts) ────────────────────────────────────────────────────
export type AcademyStatus = 'draft' | 'published' | 'in_progress' | 'completed' | 'archived';

/**
 * Chain-of-command sign-off a class goes through before it can be published.
 * Coordinator submits → Sergeant → Lieutenant → Captain (director) → approved,
 * after which the coordinator may publish. An approver can send it back with
 * "changes requested." Templates are exempt. Missing = 'not_submitted'.
 */
export type ApprovalState =
  | 'not_submitted'
  | 'pending_sergeant'
  | 'pending_lieutenant'
  | 'pending_captain'
  | 'approved'
  | 'changes_requested';

export interface ApprovalStep {
  uid: string;
  name: string;
  role: Role;
  decision: 'submitted' | 'approved' | 'changes_requested' | 'forced';
  note?: string;
  at: Timestamp;
}

export interface AcademyApproval {
  state: ApprovalState;
  /** The sergeant the coordinator routed it to (there may be two). */
  sergeantId?: string;
  /** Who submitted — the approval returns to them, and they publish. */
  submittedBy?: string;
  /** Set when an approver requests changes. */
  changesNote?: string;
  history?: ApprovalStep[];
}

export interface AcademyDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  /** Short class designation used as the calendar prefix, e.g. "LE 131", "CO 67". */
  shortName: string;
  name: string;            // e.g. "LE 131 (May Start)"
  /** The curriculum DOC id in the `curricula` collection (may be org-namespaced
   *  as {orgId}__{key} for non-founding orgs; legacy PHSC curricula are bare keys). */
  discipline: string;
  fdleProgram: string;     // e.g. "FDLE Basic Recruit Training Program — Law Enforcement"
  /** Class/course sequence number (e.g. FDLE CSN "65-2026-2010-2"). Set at
   *  creation or in the builder; prefills the attendance roster's Seq # field. */
  sequenceNo?: string;
  startDate: Timestamp;
  endDate: Timestamp;
  location: string;
  /** Default room prefilled on new sessions (individual days can differ). */
  defaultRoom?: string;
  /** Managed-room id behind `defaultRoom` (rooms/{id}); absent for custom text. */
  defaultRoomId?: string;
  /** Calendar color for this cohort (hex from the fixed palette). */
  color?: string;
  status: AcademyStatus;
  /** True for reusable schedule templates (excluded from calendars & rosters). */
  isTemplate?: boolean;
  /** Ordered: [0] = primary coordinator, [1] = secondary. */
  coordinatorIds: string[];
  targetTotalHours: number; // defaults to the curriculum's course-hour sum; editable
  /** Chain-of-command sign-off before publishing (non-templates). */
  approval?: AcademyApproval;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Academy roster (per-academy: academies/{id}/roster/{memberId}) ─────────
/** Sponsoring agency for a cadet. "other" carries a free-text agencyOther. */
export type RosterAgency = 'PSO' | 'ZPD' | 'DCPD' | 'BOCC' | 'Self' | 'Other';
export const ROSTER_AGENCIES: { key: RosterAgency; label: string }[] = [
  { key: 'PSO', label: 'PSO' },
  { key: 'ZPD', label: 'ZPD' },
  { key: 'DCPD', label: 'DCPD' },
  { key: 'BOCC', label: 'BOCC' },
  { key: 'Self', label: 'Self-sponsored' },
  { key: 'Other', label: 'Other' },
];

/** A noted disciplinary violation. Warnings count only toward the warning tally;
 *  demerits A/B/C/D carry 1/3/6/12 points. A Demerit D (12) is an AUTOMATIC
 *  DISMISSAL. The level is chosen by staff (typically escalating on repeats). */
export type ViolationType = 'Tardy' | 'Uniform' | 'Grooming' | 'Other';
export type DemeritLevel = 'warning' | 'A' | 'B' | 'C' | 'D';
export const DEMERIT_POINTS: Record<DemeritLevel, number> = { warning: 0, A: 1, B: 3, C: 6, D: 12 };
/** A single Demerit D — or this many total points — is an automatic dismissal. */
export const AUTO_DISMISSAL_POINTS = 12;
export interface ViolationEntry {
  id: string;
  date: Timestamp;
  type: ViolationType;
  typeOther?: string;     // when type === 'Other'
  level: DemeritLevel;
  notes?: string;
}

/** One graded cell for one tested course. A primary EOC exam score plus, when
 *  failed, a single lifeline: a written reexamination, or (HL only) a practical
 *  remediation — never both for HL. `na` = injured/absent, `co` = carry-over. */
export interface GradeCell {
  score?: number | null;        // primary written EOC exam %
  status?: 'na' | 'co' | 'xo';  // non-numeric outcomes: na=injured/absent, co=carry-over, xo=crossover/Blackbird (exempt)
  reexamScore?: number | null;  // written reexamination %
  remediation?: 'pass' | 'fail'; // HL practical proficiency remediation result
  lifeline?: 'reexam' | 'remediation'; // which single lifeline was used (HL)
}

export interface RosterMemberDoc {
  /** 1-based roster number, assigned on add. */
  no: number;
  fullName: string;
  agency: RosterAgency;
  agencyOther?: string;
  cjis?: string;
  studentId?: string;
  phone?: string;
  email?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  status: 'active' | 'withdrawn';
  withdrawnAt?: Timestamp;
  /** Curriculum course name the cadet was withdrawn after (grades past it show WD). */
  withdrawnAfterCourse?: string;
  /** Additional block taker (printed in a separate roster section), not a full cadet. */
  blockTaker?: boolean;
  violations?: ViolationEntry[];
  /** Grades keyed by curriculum course name. */
  grades?: Record<string, GradeCell>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Letter-grade bands (from the academy GradeBook). 80% is the pass line. */
export const GRADE_BANDS: { min: number; letter: string }[] = [
  { min: 98, letter: 'A+' },
  { min: 96, letter: 'A' },
  { min: 93, letter: 'A-' },
  { min: 90, letter: 'B+' },
  { min: 87, letter: 'B' },
  { min: 85, letter: 'B-' },
  { min: 80, letter: 'C' },
  { min: 0, letter: 'F' },
];
export const PASS_MARK = 80;
export function letterFor(pct: number): string {
  return (GRADE_BANDS.find((b) => pct >= b.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]).letter;
}

// ── Academic action reports (per-academy: academies/{id}/reports/{id}) ──────
/** FDLE Law Enforcement CJK course list (from the official forms' dropdown). */
// Official CJSTC Law Enforcement Basic Recruit course titles.
export const FDLE_LE_COURSES: { code: string; name: string }[] = [
  ['0096', 'Law Enforcement Officer Physical Fitness Training'], ['0002', 'Introduction to Law Enforcement'], ['0031', 'First Aid for Criminal Justice Officers'],
  ['0051', 'Criminal Justice Defensive Tactics'], ['0040', 'Criminal Justice Firearms'], ['0020', 'Law Enforcement Vehicle Operations'],
  ['0421', 'Conducted Electrical Weapon / Dart-Firing Stun Gun'], ['0016', 'Communication'], ['0021', 'Serving Your Community'],
  ['0018', 'Legal'], ['0073', 'Crimes Involving Property and Society'], ['0072', 'Crimes Against Persons'],
  ['0079', 'Crime Scene Follow-up Investigations'], ['0019', 'Interviewing and Report Writing'], ['0063', 'Fundamentals of Patrol'],
  ['0400', 'Traffic Incidents'], ['0401', 'Traffic Stops'], ['0403', 'DUI Traffic Stops'],
  ['0402', 'Traffic Crash Investigations'],
].map(([code, name]) => ({ code, name }));

export type ReportTypeId =
  // Academic-action letters (verbatim FL/neutral bodies; see reportTypes.tsx)
  | 'exam_failure' | 'proficiency_fail' | 'exam_course_fail' | 'academy_dismissal'
  // Phase 11 general & conduct documents (block-model; DRAFT wording pending legal pass)
  | 'general_memo' | 'counseling' | 'injury_illness' | 'incident'
  | 'use_of_force' | 'disciplinary' | 'dismissal_conduct' | 'cadet_acknowledgment'
  | 'crossover_transfer';

/**
 * Admin-managed report configuration (doc `reportConfig/global`): the custom
 * category list (LE, CO, NMT, ARGUS…) and per-report-type overrides (display
 * name + which category it belongs to). The report's fields and letter body
 * stay in the code registry (reportTypes.tsx) — only name/category are editable.
 */
export interface ReportCategory {
  key: string;
  label: string;
}
export interface ReportConfigDoc {
  categories: ReportCategory[];
  /** Per report-type-id: optional display-name override + category assignment. */
  overrides?: Record<string, { name?: string; categoryKey?: string }>;
}

/** A filed academic-action report (e.g., exam-failure letter) for one cadet. */
export interface AcademyReportDoc {
  /** Built-in report id (ReportTypeId) or an in-app builder doc's id (string). */
  type: ReportTypeId | string;
  /** Roster member id, if filed against a roster cadet. */
  cadetId?: string;
  cadetName: string;
  /** Field values keyed by the report type's field keys (see reportTypes registry). */
  data: Record<string, string>;
  createdBy: string;
  createdByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Bug / feature reports (member-submitted, admin-triaged) ────────────────
export type FeedbackKind = 'bug' | 'feature';
export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'wont_fix';

/** A member-submitted bug report or feature request (collection `feedbackReports`). */
export interface FeedbackReportDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Bugs: severity. Features: requested priority. */
  severity: FeedbackSeverity;
  area?: string;                 // which part of the app it concerns
  stepsToReproduce?: string;     // bugs
  expected?: string;             // bugs: expected behavior
  actual?: string;               // bugs: actual behavior
  screenshotUrls?: string[];     // Cloud Storage download URLs
  // Auto-captured context (no PII beyond the submitter).
  pageUrl?: string;
  userAgent?: string;
  appVersion?: string;
  // Submitter
  submittedByUid: string;
  submittedByName: string;
  submittedByEmail?: string;
  submittedByRole?: Role;
  // Triage (admins)
  status: FeedbackStatus;
  adminNotes?: string;
  resolvedByUid?: string;
  resolvedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Curricula (admin-editable disciplines + minimum hours) ─────────────────
export interface CurriculumCourse {
  /** FDLE/CJSTC course number (e.g. "CJK0040"), shown before the course name. */
  cjk?: string;
  name: string;
  minHours: number;
  /** High-liability course (firearms, DT, scenarios) — flagged ▲ in the builder/printout. */
  highLiability?: boolean;
  /** Qualification a lead instructor must hold to teach this course. */
  leadQualification?: QualificationKey;
  /** Default staffing slots beyond the lead (e.g. safety officer, role players). */
  defaultRoleSlots?: DefaultRoleSlot[];
  /**
   * Staffed by a pre-assigned coordinator rather than an open instructor lead
   * (e.g. orientation, equipment issue, team building). New sessions default to
   * a coordinator slot owned by the academy's coordinator — no open sign-up.
   */
  coordinatorRun?: boolean;
  /** Has an end-of-course exam — becomes a graded column in the roster gradebook. */
  tested?: boolean;
  /**
   * FDLE staffing ratio: students per instructor (e.g. 6 = one instructor per
   * six cadets). The builder warns when a session for this course is below it.
   */
  instructorRatio?: number;
  /** Default FDLE course sequence number (e.g. "65-2026-2010-2") — editable at print. */
  courseSeqNo?: string;
}

/** `curricula/{key}` — one per discipline; drives academy creation and the
 *  per-course hours tally in the builder. Admin-editable. */
/**
 * Roster module tabs that can be enabled per discipline. Members always shows.
 * Attendance is discipline-specific (each variant has its own print format);
 * more keys are added here as modules ship. See ROSTER_MODULES registry.
 */
export type RosterModuleKey =
  | 'le_attendance'
  | 'co_attendance'
  | 'argus_attendance'
  | 'nmt_attendance'
  | 'discipline'
  | 'grades'
  | 'reports';

export interface CurriculumDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  key: string;             // base key, e.g. 'le_brt' (doc id may be org-namespaced: {orgId}__{key})
  label: string;           // "Law Enforcement (Basic Recruit)"
  fdleProgram: string;
  courses: CurriculumCourse[];
  /** Sum of course minHours — denormalized for the create-academy default. */
  totalHours: number;
  active: boolean;
  estimated?: boolean;     // true when hours came from secondary sources
  // ── Per-discipline roster configuration (extensible; see RosterModuleKey) ──
  /** Roster tabs enabled for this discipline (Members always shows). Unset = default set. */
  rosterModules?: RosterModuleKey[];
  /** Printed attendance-roster layout for this discipline: 'grid' = the standard
   *  per-course sign-in/out grid; 'signin' = a NO./CJIS & Name/Signature sign-in
   *  sheet (e.g. NMT/ARGUS). Default 'grid'. Extend as new formats ship. */
  attendanceLayout?: 'grid' | 'signin';
  /** @deprecated category model removed; superseded by the document library + the
   *  form-override fields below. Kept for back-compat read only. */
  reportCategories?: string[];
  /** @deprecated superseded by the form-override fields below — back-compat read only. */
  reportTypeIds?: string[];

  // ── Per-discipline document overrides (unified-documents redesign) ──
  /** Branding overrides for THIS discipline's printed documents; each falls back
   *  to the org's settings when unset. Lets one org run multiple programs under
   *  different identities (e.g. an NMT program under the Sheriff's Office brand). */
  brandLogoUrl?: string;
  brandOrgName?: string;
  brandTagline?: string;
  brandAddressLines?: string[];
  /** Swap a general/base form for a specialized library form on this discipline
   *  (base form id → documentLibrary form id). */
  formOverrides?: Record<string, string>;
  /** General/base form ids hidden from this discipline's Reports tab. */
  disabledForms?: string[];
  /** Org-assigned specialized library form ids ADDED to this discipline. */
  addedForms?: string[];
}
// Note: the owner document library type (LibraryFormDoc) lives in
// src/features/cadre/reports/documentLibrary.ts so it can reference ReportField/
// DocBlock from the reports feature without a circular import.

// ── Sessions & staffing slots ──────────────────────────────────────────────
/**
 * Two-stage publishing:
 *   draft      — only staff can see it (academy unpublished or session WIP)
 *   scheduled  — visible on calendars once the academy is published, but NOT
 *                yet open for sign-up ("the course isn't published yet")
 *   open       — coordinators opened sign-ups for this course/session
 */
export type SessionStatus = 'draft' | 'scheduled' | 'open' | 'fully_staffed' | 'cancelled' | 'completed';

export interface RoleSlot {
  slotId: string;
  role: SlotRole;
  count: number;
  requiredQualificationKey?: QualificationKey;
  filledBy: string[]; // uids; invariant: length <= count (enforced in transaction + rules guard)
}

export interface SessionDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  /**
   * Block kind. Undefined/'session' = a real instructional block. 'lunch' = a
   * non-instructional placeholder (break/lunch) shown on the builder + printed
   * schedule for context — always hours:0, no roleSlots, never staffed/signed
   * up for, and excluded from every hours total. This is SEPARATE from the
   * per-session lunch carve-out (lunchMinutes), which still applies to sessions.
   */
  kind?: 'session' | 'lunch';
  academyId: string;
  courseId: string;
  courseName: string;     // denormalized from courseCatalog
  highLiability: boolean; // denormalized from courseCatalog
  title?: string;         // optional display override
  start: Timestamp;
  end: Timestamp;
  location: string;
  room: string;
  /** Managed room reference (rooms/{id}) when a room from the reservation system
   *  is chosen; absent for legacy or custom (free-text) rooms. `room` always holds
   *  the display name. Conflict-checking keys off roomId (falls back to name). */
  roomId?: string;
  /** Instructional hours = wall-clock span minus the lunch break (unless lunch counts — see below). */
  hours: number;
  /** Minutes of lunch carved out of the middle of the block (not instructional). */
  lunchMinutes?: number;
  /** When the lunch break starts, "HH:MM" 24h (default "12:00"). */
  lunchStart?: string;
  /**
   * When true, the lunch minutes count toward instructional hours instead of
   * being carved out (e.g. an ARGUS firearms block 0800–1700 with a 30-min
   * lunch that still counts as 9 hrs). Default/undefined = lunch is excluded.
   */
  lunchCountsTowardHours?: boolean;
  /**
   * False for agency-specific blocks (PSO assignments, resiliency days,
   * formation, drill, study halls…) that exist for member minimum-hour
   * requirements and must NOT count toward the FDLE program hours.
   * Missing/undefined = true (counts).
   */
  countsTowardFdle?: boolean;
  status: SessionStatus;
  roleSlots: RoleSlot[];
  notes?: string;
  createdBy: string;
  updatedAt: Timestamp;
}

/**
 * Room-reservation system (org-scoped; the program is universal, the data is
 * per-tenant). A **category** is a location (College, Range, off-site venue…);
 * a **room** lives in a category. Bookings are sessions that reference a room
 * via `SessionDoc.roomId` — there is no separate booking doc in P1.
 */
export interface RoomCategoryDoc {
  /** Tenant (orgs/{orgId}). */
  orgId?: string;
  name: string;
  /** Manual sort order (lower first); falls back to name. */
  order?: number;
  createdAt?: Timestamp;
}

export interface RoomDoc {
  /** Tenant (orgs/{orgId}). */
  orgId?: string;
  /** Parent category (roomCategories/{id}). */
  categoryId: string;
  name: string;
  /** Optional seat count — used to warn when a class exceeds capacity. */
  capacity?: number;
  notes?: string;
  /** Calendar color (hex); falls back to a category/default color. */
  color?: string;
  /** Future: an uploaded floor-plan/diagram (Storage URL). */
  diagramUrl?: string;
  /** Soft-delete: inactive rooms drop out of pickers but keep historical bookings. */
  active?: boolean;
  createdAt?: Timestamp;
}

export type SignupStatus = 'confirmed' | 'waitlist' | 'withdrawn';

export interface SignupDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  uid: string;
  displayName: string;
  role: SlotRole;
  slotId: string;
  status: SignupStatus;
  signedUpAt: Timestamp;
}

/** Denormalized mirror powering "My Schedule" and Gjallarhorn reminders. */
export interface AssignmentDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  uid: string;
  sessionId: string;
  academyId: string;
  role: SlotRole;
  courseName: string;
  location: string;
  room: string;
  start: Timestamp;
  end: Timestamp;
  status: SignupStatus;
  reminderSent: boolean;
  createdAt: Timestamp;
}

// ── Gjallarhorn: notifications, mail, audit ────────────────────────────────
export type NotificationType =
  | 'signup_confirmed'
  | 'slot_reopened'
  | 'session_fully_staffed'
  | 'lead_withdrawal_escalation'
  | 'schedule_change'
  | 'qualification_approved'
  | 'course_published'
  | 'account_approved'
  | 'new_account_pending'
  | 'account_suspended'
  | 'account_reinstated'
  | 'approval_request'
  | 'approval_update'
  | 'reminder'
  | 'understaffing_alert'
  | 'digest'
  | 'message'
  | 'feedback_submitted';

export interface NotificationDoc {
  uid: string; // recipient
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: Timestamp;
}

/** Watched by the Trigger Email extension. Server-written only. */
export interface MailDoc {
  to: string[];
  message: { subject: string; html: string; text: string };
  createdAt: Timestamp;
}

export interface AuditLogDoc {
  /** Tenant (orgs/{orgId}); set at provisioning/backfill. */
  orgId?: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: Timestamp;
}

// ── Convenience helpers ────────────────────────────────────────────────────
export function isStaff(role: Role | undefined | null): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function isAdmin(role: Role | undefined | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** A session is understaffed if any role slot has fewer filled than required. */
export function unfilledSlots(session: SessionDoc): RoleSlot[] {
  return session.roleSlots.filter((s) => s.filledBy.length < s.count);
}

export function isFullyStaffed(session: SessionDoc): boolean {
  return unfilledSlots(session).length === 0;
}
