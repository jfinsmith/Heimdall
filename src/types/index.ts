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
  { key: 'account_approved', label: 'Account approved', description: 'Emails a new user when their account is activated.' },
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
  /** Master kill-switch for ALL outbound email (in-app notifications still fire). */
  emailMasterEnabled: boolean;
  /** Per-automation email toggles; missing key = enabled. */
  emailAutomations: Partial<Record<EmailAutomationKey, boolean>>;
}

// ── Curriculum ─────────────────────────────────────────────────────────────
export type Discipline = 'law_enforcement' | 'corrections' | 'cross_over' | 'all';

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  law_enforcement: 'Law Enforcement',
  corrections: 'Corrections',
  cross_over: 'Cross-Over',
  all: 'All Disciplines',
};

export type SlotRole = 'lead' | 'assistant' | 'role_player' | 'safety_officer';

export const SLOT_ROLE_LABELS: Record<SlotRole, string> = {
  lead: 'Lead Instructor',
  assistant: 'Assistant Instructor',
  role_player: 'Role Player',
  safety_officer: 'Safety Officer',
};

export interface DefaultRoleSlot {
  role: SlotRole;
  count: number;
  requiredQualificationKey?: QualificationKey;
}

export interface CourseDoc {
  name: string;
  fdleCourseCode: string;
  discipline: Discipline;
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
  discipline: Exclude<Discipline, 'all'>;
  fdleProgram: string;     // e.g. "FDLE Basic Recruit Training Program — Law Enforcement"
  startDate: Timestamp;
  endDate: Timestamp;
  location: string;
  status: AcademyStatus;
  coordinatorIds: string[];
  targetTotalHours: number; // configurable, e.g. LE ≈ 770, Corrections ≈ 520
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Sessions & staffing slots ──────────────────────────────────────────────
export type SessionStatus = 'draft' | 'open' | 'fully_staffed' | 'cancelled' | 'completed';

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
  hours: number;
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
  | 'account_approved'
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
