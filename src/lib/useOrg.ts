/**
 * The signed-in user's own org doc (orgs/{orgId}). Phase-5 rules allow a user to
 * read their own org. Returns { data, loading, error } like useDoc; data is null
 * until loaded or when the user has no tenant yet.
 */
import { useAuth } from '../auth/AuthContext';
import { useDoc } from './firestore';
import type { OrgDoc } from '../types';

export function useOrg() {
  // A read-only Viewer may not read the org doc (rules deny it); its page gets
  // the org name and suspension check from the getViewerStaffing callable.
  const { orgId, role } = useAuth();
  return useDoc<OrgDoc>(orgId && role !== 'viewer' ? `orgs/${orgId}` : null);
}
