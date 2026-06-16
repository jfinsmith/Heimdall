/**
 * Server-side copies of the shared HEIMDALL types (mirrors src/types/index.ts
 * in the web app — keep both in sync). Uses firebase-admin Timestamps.
 */
import type { Timestamp } from 'firebase-admin/firestore';

export type Role = 'director' | 'lieutenant' | 'sergeant' | 'coordinator' | 'instructor';
export type UserStatus = 'pending' | 'active' | 'inactive' | 'suspended';
export type SlotRole = 'lead' | 'assistant' | 'role_player' | 'safety_officer' | 'coordinator';
export type SessionStatus = 'draft' | 'open' | 'fully_staffed' | 'cancelled' | 'completed';
export type SignupStatus = 'confirmed' | 'waitlist' | 'withdrawn';

export const STAFF_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator'];
export const ADMIN_ROLES: Role[] = ['director', 'lieutenant'];

export interface Qualification {
  key: string;
  label: string;
  verified: boolean;
  verifiedBy?: string;
  /** Date the certifying course was attended (expiration tracked in a separate portal). */
  attendedOn?: Timestamp | null;
}

export interface UserDoc {
  email: string;
  displayName: string;
  rank?: string;
  agency?: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  qualifications: Qualification[];
  /** Staff-maintained authoritative verified keys (see web app types). */
  verifiedQualKeys: string[];
  notificationPrefs: { email: boolean; reminderLeadHours: number; digest: boolean };
  /** Forces a password change on first sign-in (admin-created accounts). */
  mustChangePassword?: boolean;
}

export interface GlobalSettings {
  orgName: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl?: string;
  allowedEmailDomains: string[];
  reminderDefaultLeadHours: number;
  understaffingAlertDays: number;
  escalationRecipients: string[];
  weeklyDigestEnabled: boolean;
  /** Master kill-switch for ALL outbound email (in-app notifications still fire). */
  emailMasterEnabled?: boolean;
  /** Per-automation email toggles, keyed by NotificationType; missing key = enabled. */
  emailAutomations?: Record<string, boolean>;
  /** Per-automation recipient-role filter; non-empty list = only those roles get the email. */
  emailAutomationRoles?: Record<string, Role[]>;
  /** Lead-withdrawal escalation window (days before a session) — default 7. */
  escalationWindowDays?: number;
}

/**
 * Email for a notification type is allowed unless the master switch is off, its
 * per-automation toggle is off, or a recipient-role filter excludes this role.
 */
export function emailAllowed(settings: GlobalSettings | null, type: string, recipientRole?: Role): boolean {
  if (!settings) return true;
  if (settings.emailMasterEnabled === false) return false;
  if (settings.emailAutomations?.[type] === false) return false;
  const roles = settings.emailAutomationRoles?.[type];
  if (roles && roles.length > 0 && recipientRole && !roles.includes(recipientRole)) return false;
  return true;
}

export interface RoleSlot {
  slotId: string;
  role: SlotRole;
  count: number;
  requiredQualificationKey?: string;
  filledBy: string[];
}

export interface SessionDoc {
  academyId: string;
  courseId: string;
  courseName: string;
  highLiability: boolean;
  title?: string;
  start: Timestamp;
  end: Timestamp;
  location: string;
  room: string;
  hours: number;
  status: SessionStatus;
  roleSlots: RoleSlot[];
  createdBy: string;
}

export type ApprovalState =
  | 'not_submitted'
  | 'pending_sergeant'
  | 'pending_lieutenant'
  | 'pending_captain'
  | 'approved'
  | 'changes_requested';

export interface AcademyDoc {
  name: string;
  shortName?: string;
  coordinatorIds: string[];
  status: string;
  isTemplate?: boolean;
  approval?: {
    state: ApprovalState;
    sergeantId?: string;
    submittedBy?: string;
    changesNote?: string;
    history?: { uid: string; name: string; role: Role; decision: string; note?: string; at: Timestamp }[];
  };
}

export interface SignupDoc {
  uid: string;
  displayName: string;
  role: SlotRole;
  slotId: string;
  status: SignupStatus;
  signedUpAt: Timestamp;
}

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
}
