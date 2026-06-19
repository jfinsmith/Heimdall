/**
 * Lightweight Firestore read hooks (we deliberately use these instead of
 * React Query to keep the dependency surface small and stay consistent —
 * one data-fetching idiom across the app, with live onSnapshot updates).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  Query,
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from '../auth/AuthContext';

export type WithId<T> = T & { id: string };

/**
 * Top-level collections that are NOT tenant-scoped and must never have an orgId
 * filter injected: the org registry, per-user notifications (already scoped by
 * uid), and server-only mail. Everything else top-level is org-owned. (Cross-org
 * reads for the platform owner, e.g. feedback triage, use dedicated queries, not
 * this hook.)
 */
// `documentLibrary` is the owner-managed forms library — NOT tenant-scoped (forms
// are general-to-all or assigned to N orgs), so it must NOT get an injected
// orgId filter; access is gated by availability/orgIds in firestore.rules and the
// staff hook queries it explicitly (by availability / array-contains orgId).
const NON_ORG_SCOPED = new Set(['orgs', 'notifications', 'mail', 'defaultCurricula', 'documentLibrary']);
// Org-owned SUBCOLLECTIONS (academies/{id}/roster, etc.). Their list reads must
// also be filtered by orgId — a subcollection list query with no orgId filter is
// denied ENTIRELY by Firestore if any sibling doc fails the per-doc inOrg rule
// (e.g. one org-less leftover), which silently empties the whole list. Filtering
// makes Firestore evaluate the rule only on matching docs (excluding the rest).
const ORG_SCOPED_SUBCOLLECTIONS = new Set(['roster', 'reports', 'signups']);

interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a collection query. `constraints` is memoized by JSON identity
 * of the deps array — pass `deps` listing the primitive values your
 * constraints depend on.
 */
export function useCollection<T = DocumentData>(
  path: string | null,
  constraints: QueryConstraint[] = [],
  deps: unknown[] = []
): QueryState<WithId<T>> {
  const [state, setState] = useState<QueryState<WithId<T>>>({ data: [], loading: true, error: null });
  const { orgId } = useAuth();

  // Tenant isolation: top-level org-owned collections are filtered to the
  // caller's org. DORMANT until users carry an orgId (post-backfill) — a no-op
  // for the current single-tenant deployment, so PHSC behaves exactly as before.
  // Subcollections (e.g. academies/{id}/roster) inherit their parent's org and
  // are not filtered here.
  const segments = path ? path.split('/').filter(Boolean) : [];
  const lastSeg = segments[segments.length - 1];
  // Inject the orgId filter for org-owned top-level collections AND org-owned
  // subcollections (collection paths have an odd segment count).
  const orgScope =
    orgId &&
    ((segments.length === 1 && !NON_ORG_SCOPED.has(segments[0])) ||
      (segments.length >= 3 && segments.length % 2 === 1 && ORG_SCOPED_SUBCOLLECTIONS.has(lastSeg)))
      ? orgId
      : null;

  const q: Query | null = useMemo(
    () => {
      if (!path) return null;
      const all = orgScope ? [where('orgId', '==', orgScope), ...constraints] : constraints;
      return query(collection(db, path), ...all);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, orgScope, ...deps]
  );

  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })),
          loading: false,
          error: null,
        });
      },
      (error) => {
        console.error(`useCollection(${path}) failed:`, error);
        setState({ data: [], loading: false, error });
      }
    );
    return unsub;
  }, [q]);

  return state;
}

interface DocState<T> {
  data: WithId<T> | null;
  loading: boolean;
  error: Error | null;
}

/** Subscribe to a single document. */
export function useDoc<T = DocumentData>(path: string | null): DocState<T> {
  const [state, setState] = useState<DocState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => {
        setState({
          data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as WithId<T>) : null,
          loading: false,
          error: null,
        });
      },
      (error) => {
        console.error(`useDoc(${path}) failed:`, error);
        setState({ data: null, loading: false, error });
      }
    );
    return unsub;
  }, [path]);

  return state;
}

/** Generate a short random id for role slots etc. (not a Firestore doc id). */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Per-org config doc path. `settings`/`reportConfig` move from a single 'global'
 * doc to one per tenant (doc id == orgId). Falls back to 'global' when there's
 * no orgId yet (pre-backfill) — so this is dormant for the single-tenant
 * deployment and the same doc is read/written exactly as before.
 */
export const orgConfigPath = (coll: 'settings' | 'reportConfig', orgId?: string | null): string =>
  `${coll}/${orgId || 'global'}`;
