/**
 * HEIMDALL shared TypeScript interfaces — mirrors the Firestore data model.
 * Keep in sync with functions/src/types.ts (the Cloud Functions copy) and
 * firestore.rules. All date fields are Firestore Timestamps.
 */
import type { Timestamp } from 'firebase/firestore';

// ── Roles & chain of command ───────────────────────────────────────────────
// Instructor → Coordinator → Sergeant → Lieutenant → Director (Captain)
export type Role = 'director' | 'lieutenant' | 'sergeant' | 'coordinator' | 'instructor';

/** Roles that can build schedules / approve sign-ups ("coordinator+"). */
export const STAFF_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator'];
/** Roles that can manage users and org settings ("command"). */
export const ADMIN_ROLES: Role[] = ['director', 'lieutenant'];

export type UserStatus = 'pending' | 'active' | 'inactive';

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

export interface Qualification {
  key: QualificationKey;
  label: string;
  /** Approval-gated: claimed by the user, verified by a supervisor/coordinator. */
  verified: boolean;
  verifiedBy?: string; // uid
  /** Date the instructor attended the certifying course (expiration is tracked in a separate portal). */
  attendedOn: Timestamp | null;
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
  notificationPrefs: NotificationPrefs;
  /** Random token for the personal ICS calendar-feed URL (user-generated). */
  icsToken?: string;
  /**
   * Set true when an admin creates the account with a temporary password.
   * The app forces a password change on first sign-in and clears this flag
   * once the user picks their own password.
   */
  mustChangePassword?: boolean;
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
  { key: 'reminder', label: 'Assignment reminders', description: 'Daily sweep: emails instructors ahead of their upcoming assignments.' },
  { key: 'understaffing_alert', label: 'Understaffing alerts', description: 'Daily sweep: emails coordinators + command about unfilled slots inside the alert window.' },
  { key: 'digest', label: 'Weekly digest', description: 'Monday summary of staffing health for coordinators and command.' },
  { key: 'message', label: 'Bulk messages', description: 'Manual broadcasts sent from the Staffing Board.' },
] as const;

export type EmailAutomationKey = (typeof EMAIL_AUTOMATIONS)[number]['key'];

// ── Org settings (settings/global singleton) ───────────────────────────────
export interface GlobalSettings {
  orgName: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl?: string;
  allowedEmailDomains: string[]; // empty = allow any
  reminderDefaultLeadHours: number;       // Gjallarhorn
  understaffingAlertDays: number;         // alert window for unfilled required slots
  escalationRecipients: string[];         // uids or emails for command alerts
  weeklyDigestEnabled: boolean;
  /** Holiday keys turned OFF for this org's calendars (e.g. Juneteenth). */
  disabledHolidays?: string[];
  /** Holiday keys the agency observes as paid (grant holiday-pay hours). */
  observedHolidays?: string[];
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

export interface AcademyDoc {
  /** Short class designation used as the calendar prefix, e.g. "LE 131", "CO 67". */
  shortName: string;
  name: string;            // e.g. "LE 131 (May Start)"
  /** Key into the `curricula` collection (admin-editable disciplines). */
  discipline: string;
  fdleProgram: string;     // e.g. "FDLE Basic Recruit Training Program — Law Enforcement"
  startDate: Timestamp;
  endDate: Timestamp;
  location: string;
  /** Default room prefilled on new sessions (individual days can differ). */
  defaultRoom?: string;
  /** Calendar color for this cohort (hex from the fixed palette). */
  color?: string;
  status: AcademyStatus;
  /** True for reusable schedule templates (excluded from calendars & rosters). */
  isTemplate?: boolean;
  /** Ordered: [0] = primary coordinator, [1] = secondary. */
  coordinatorIds: string[];
  targetTotalHours: number; // defaults to the curriculum's course-hour sum; editable
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Curricula (admin-editable disciplines + minimum hours) ─────────────────
export interface CurriculumCourse {
  name: string;
  minHours: number;
}

/** `curricula/{key}` — one per discipline; drives academy creation and the
 *  per-course hours tally in the builder. Admin-editable. */
export interface CurriculumDoc {
  key: string;             // doc id, e.g. 'le_brt'
  label: string;           // "Law Enforcement (Basic Recruit)"
  fdleProgram: string;
  courses: CurriculumCourse[];
  /** Sum of course minHours — denormalized for the create-academy default. */
  totalHours: number;
  active: boolean;
  estimated?: boolean;     // true when hours came from secondary sources
}

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
  academyId: string;
  courseId: string;
  courseName: string;     // denormalized from courseCatalog
  highLiability: boolean; // denormalized from courseCatalog
  title?: string;         // optional display override
  start: Timestamp;
  end: Timestamp;
  location: string;
  room: string;
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

export type SignupStatus = 'confirmed' | 'waitlist' | 'withdrawn';

export interface SignupDoc {
  uid: string;
  displayName: string;
  role: SlotRole;
  slotId: string;
  status: SignupStatus;
  signedUpAt: Timestamp;
}

/** Denormalized mirror powering "My Schedule" and Gjallarhorn reminders. */
export interface AssignmentDoc {
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
  | 'reminder'
  | 'understaffing_alert'
  | 'digest'
  | 'message';

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
