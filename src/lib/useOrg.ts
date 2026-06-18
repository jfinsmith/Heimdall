/**
 * The signed-in user's own org doc (orgs/{orgId}). Phase-5 rules allow a user to
 * read their own org. Returns { data, loading, error } like useDoc; data is null
 * until loaded or when the user has no tenant yet.
 */
import { useAuth } from '../auth/AuthContext';
import { useDoc } from './firestore';
import type { OrgDoc } from '../types';

export function useOrg() {
  const { orgId } = useAuth();
  return useDoc<OrgDoc>(orgId ? `orgs/${orgId}` : null);
}
