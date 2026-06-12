/**
 * Client-side RBAC helpers. Authoritative enforcement lives in
 * firestore.rules (custom claims) — these only shape the UI.
 */
import type { Role } from '../types';
import { isAdmin, isStaff } from '../types';

export const can = {
  /** Create/edit/clone academies, sessions, role slots; approve sign-ups. */
  buildSchedules: (role?: Role | null) => isStaff(role),
  /** Manage users, assign roles, edit org settings & branding. */
  manageOrg: (role?: Role | null) => isAdmin(role),
  /** Verify instructor qualifications. */
  verifyQualifications: (role?: Role | null) => isStaff(role),
  /** See draft (unpublished) academies and the staffing dashboard. */
  viewStaffing: (role?: Role | null) => isStaff(role),
  /** Everyone signed in may sign up for qualified slots. */
  signUp: (role?: Role | null) => !!role,
};

export const ROLE_LABELS: Record<Role, string> = {
  director: 'Director (Captain)',
  lieutenant: 'Lieutenant',
  sergeant: 'Sergeant',
  coordinator: 'Coordinator',
  instructor: 'Instructor',
};

/** Chain of command, highest first — used for escalation routing displays. */
export const CHAIN_OF_COMMAND: Role[] = ['director', 'lieutenant', 'sergeant', 'coordinator', 'instructor'];
