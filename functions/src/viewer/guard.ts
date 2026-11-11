/**
 * Viewer accounts are READ-ONLY. A Viewer (role 'viewer', minted only by
 * scripts/create-viewer.ts) reads staffing through getViewerStaffing and
 * nothing else; every callable that changes anything refuses it.
 *
 * Staff- and admin-only callables already refuse a Viewer (its role is in
 * neither STAFF_ROLES nor ADMIN_ROLES). These helpers are for the MEMBER-level
 * callables any signed-in member may call (sign-up, withdraw, reservations,
 * notification email), which would otherwise treat a Viewer like an instructor.
 */
import { HttpsError } from 'firebase-functions/v2/https';

export const VIEWER_ROLE = 'viewer';

/** Anything carrying a role: a decoded ID token (custom claims sit at the top
 *  level) or a user profile document. */
type HasRole = object | null | undefined;
const roleOf = (x: HasRole): unknown => (x as { role?: unknown } | null | undefined)?.role;

/** The token or the profile says Viewer. Either is enough to refuse a write. */
export function isViewer(token?: HasRole, profile?: HasRole): boolean {
  return roleOf(token) === VIEWER_ROLE || roleOf(profile) === VIEWER_ROLE;
}

/** Refuse a write from a Viewer account (checked before anything is read or written). */
export function refuseViewer(token?: HasRole, profile?: HasRole): void {
  if (isViewer(token, profile)) {
    throw new HttpsError('permission-denied', 'This is a read-only Viewer account — it cannot make changes.');
  }
}
