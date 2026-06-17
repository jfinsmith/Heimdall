/**
 * Client-side RBAC helpers. Authoritative enforcement lives in
 * firestore.rules (custom claims) — these only shape the UI.
 *
 * One RANKS registry is the single source of truth for rank order, default
 * labels, and summaries; chain-of-command, label maps, and every role-ordered
 * dropdown derive from it so they can never drift. Role KEYS are stable
 * (claims + rules depend on them); DISPLAY labels are editable per-org via
 * GlobalSettings.roleLabels — resolve with getRankLabel()/rankLabels().
 */
import type { GlobalSettings, Role } from '../types';
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
  /** Signed-in members (except read-only guests) may sign up for qualified slots. */
  signUp: (role?: Role | null) => !!role && role !== 'guest',
};

/** Single source of truth — ranks lowest → highest. Everything below derives from this. */
export const RANKS: { key: Role; defaultLabel: string; summary: string }[] = [
  {
    key: 'guest',
    defaultLabel: 'Guest/Visitor',
    summary:
      'Read-only visitor. Sees published schedules and the calendar but cannot sign up, build, or manage anything. Granted by an admin.',
  },
  {
    key: 'instructor',
    defaultLabel: 'Instructor',
    summary:
      'Views published schedules, signs up for (and withdraws from) qualified slots, and manages their own profile and qualification claims.',
  },
  {
    key: 'coordinator',
    defaultLabel: 'Coordinator',
    summary:
      'Builds and runs academies: creates and edits schedules and sessions, approves sign-ups, verifies qualifications. The hands-on scheduling role.',
  },
  {
    key: 'sergeant',
    defaultLabel: 'Sergeant (Supervisor)',
    summary:
      'Academy administrator. Full control over academies, schedules, sessions, sign-ups, and qualification verification — no user/role management or site settings.',
  },
  {
    key: 'lieutenant',
    defaultLabel: 'Lieutenant (Vice Director)',
    summary:
      'Full administrator. Manages users, roles, org settings, and email automations, plus everything below.',
  },
  {
    key: 'director',
    defaultLabel: 'Captain (Director)',
    summary:
      'Full administrator. Everything a lieutenant can do — captains and lieutenants are intentionally identical.',
  },
];

/** Default labels (key → label). Per-org overrides applied via getRankLabel/rankLabels. */
export const ROLE_LABELS: Record<Role, string> = Object.fromEntries(
  RANKS.map((r) => [r.key, r.defaultLabel])
) as Record<Role, string>;

/** One-line summary of each role, shown on the permissions reference page. */
export const ROLE_SUMMARIES: Record<Role, string> = Object.fromEntries(
  RANKS.map((r) => [r.key, r.summary])
) as Record<Role, string>;

/** Ranks lowest → highest (e.g. for user-list grouping / email role filters). */
export const RANK_ORDER_ASC: Role[] = RANKS.map((r) => r.key);

/** Chain of command, highest first — used for escalation routing displays. */
export const CHAIN_OF_COMMAND: Role[] = [...RANKS].reverse().map((r) => r.key);

/** Resolve a rank's display label, honoring the org's editable override. */
export function getRankLabel(role: Role, settings?: GlobalSettings | null): string {
  return settings?.roleLabels?.[role]?.trim() || ROLE_LABELS[role];
}

/** Full key→label map with per-org overrides applied. */
export function rankLabels(settings?: GlobalSettings | null): Record<Role, string> {
  return Object.fromEntries(RANKS.map((r) => [r.key, getRankLabel(r.key, settings)])) as Record<Role, string>;
}

/**
 * The capability matrix rendered (read-only) at Admin → Roles & Permissions.
 * Enforcement lives in firestore.rules + the callable functions — this table
 * is documentation and must be kept in sync with them.
 */
export const PERMISSION_MATRIX: { capability: string; roles: Record<Role, boolean> }[] = [
  { capability: 'View published academies, calendar & open sessions', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true, guest: true } },
  { capability: 'Sign up / withdraw for qualified slots', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true, guest: false } },
  { capability: 'Edit own profile & claim qualifications', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: true, guest: true } },
  { capability: 'View draft academies, staffing board & reports', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Create / edit / clone academies & schedules', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Create / edit / cancel sessions & role slots', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Approve / override instructor sign-ups', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Verify instructor qualifications', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Send bulk messages (Gjallarhorn)', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Receive escalation / understaffing alerts', roles: { director: true, lieutenant: true, sergeant: true, coordinator: true, instructor: false, guest: false } },
  { capability: 'Approve pending users & deactivate accounts', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false, guest: false } },
  { capability: 'Assign roles (writes the auth claim)', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false, guest: false } },
  { capability: 'Org settings, branding & allowed domains', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false, guest: false } },
  { capability: 'Gjallarhorn settings & email automations', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false, guest: false } },
  { capability: 'View audit log', roles: { director: true, lieutenant: true, sergeant: false, coordinator: false, instructor: false, guest: false } },
];
