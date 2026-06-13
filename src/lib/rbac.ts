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

/** One-line summary of each role, shown on the permissions reference page. */
export const ROLE_SUMMARIES: Record<Role, string> = {
  director:
    'Full administrator. Everything a lieutenant can do — directors and lieutenants are intentionally identical.',
  lieutenant:
    'Full administrator. Manages users, roles, org settings, and email automations, plus everything below.',
  sergeant:
    'Academy administrator. Full control over academies, schedules, sessions, sign-ups, and qualification verification — no user/role management or site settings.',
  coordinator:
    'Builds and runs academies: creates and edits schedules and sessions, approves sign-ups, verifies qualifications. The hands-on scheduling role.',
  instructor:
    'Views published schedules, signs up for (and withdraws from) qualified slots, and manages their own profile and qualification claims.',
};

/**
 * The capability matrix rendered (read-only) at Admin → Roles & Permissions.
 * Enforcement lives in firestore.rules + the callable functions — this table
 * is documentation and must be kept in sync with them.
 */
export const PERMISSION_MATRIX: { capability: string; roles: Record<Role, boolean> }[] = [
  { capability: 'View published academies, calendar & open sessions', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true } },
  { capability: 'Sign up / withdraw for qualified slots', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true } },
  { capability: 'Edit own profile & claim qualifications', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true } },
  { capability: 'View draft academies, staffing board & reports', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Create / edit / clone academies & schedules', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Create / edit / cancel sessions & role slots', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Approve / override instructor sign-ups', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Verify instructor qualifications', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Send bulk messages (Gjallarhorn)', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Receive escalation / understaffing alerts', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false } },
  { capability: 'Approve pending users & deactivate accounts', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false } },
  { capability: 'Assign roles (writes the auth claim)', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false } },
  { capability: 'Org settings, branding & allowed domains', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false } },
  { capability: 'Gjallarhorn settings & email automations', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false } },
  { capability: 'View audit log', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false } },
];
