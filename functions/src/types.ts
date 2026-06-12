/**
 * Server-side copies of the shared HEIMDALL types (mirrors src/types/index.ts
 * in the web app — keep both in sync). Uses firebase-admin Timestamps.
 */
import type { Timestamp } from 'firebase-admin/firestore';

export type Role = 'director' | 'lieutenant' | 'sergeant' | 'coordinator' | 'instructor';
export type UserStatus = 'pending' | 'active' | 'inactive';
export type SlotRole = 'lead' | 'assistant' | 'role_player' | 'safety_officer' | 'evaluator';
export type SessionStatus = 'draft' | 'open' | 'fully_staffed' | 'cancelled' | 'completed';
export type SignupStatus = 'confirmed' | 'waitlist' | 'withdrawn';

export const STAFF_ROLES: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator'];
export const ADMIN_ROLES: Role[] = ['director', 'lieutenant'];

export interface Qualification {
  key: string;
  label: string;
  verified: boolean;
  verifiedBy?: string;
  expires?: Timestamp | null;
}

export interface UserDoc {
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  qualifications: Qualification[];
  /** Staff-maintained authoritative verified keys (see web app types). */
  verifiedQualKeys: string[];
  notificationPrefs: { email: boolean; reminderLeadHours: number; digest: boolean };
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

export interface AcademyDoc {
  name: string;
  coordinatorIds: string[];
  status: string;
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
