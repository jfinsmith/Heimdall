/**
 * Lightweight Firestore read hooks (we deliberately use these instead of
 * React Query to keep the dependency surface small and stay consistent —
 * one data-fetching idiom across the app, with live onSnapshot updates).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
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
import { auth, db } from './firebase';
import { useAuth } from '../auth/AuthContext';

export type WithId<T> = T & { id: string };

// ── Healing denied listeners ──────────────────────────────────────────────
// A Firestore listener that is denied is DEAD: it never retries. Rules read the
// caller's token claims (orgId, role, status), and those arrive mid-session —
// an account is approved, joins an org, or is switched by the owner while the
// tab is open. Any listener that subscribed a moment before the fresh token
// landed (org settings, the org doc, a page's list) stayed empty until a full
// reload. So: every ID-token change bumps an epoch, and a listener whose last
// answer was permission-denied re-subscribes once per new token. Healthy
// listeners are untouched; a listener that is denied again simply waits for the
// next token (no retry loop).
let tokenEpoch = 0;
let tokenWatchStarted = false;
const tokenWatchers = new Set<() => void>();
function subscribeTokenEpoch(onChange: () => void): () => void {
  if (!tokenWatchStarted) {
    tokenWatchStarted = true;
    onIdTokenChanged(auth, () => {
      tokenEpoch += 1;
      tokenWatchers.forEach((fn) => fn());
    });
  }
  tokenWatchers.add(onChange);
  return () => {
    tokenWatchers.delete(onChange);
  };
}
const readTokenEpoch = () => tokenEpoch;

/** Returns [retryKey, markDenied]: put `retryKey` in the subscribing effect's
 *  deps and call `markDenied(error)` from the listener's error callback. */
function useRetryAfterDenied(): [number, (error: { code?: string }) => void] {
  const epoch = useSyncExternalStore(subscribeTokenEpoch, readTokenEpoch);
  const deniedAt = useRef<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (deniedAt.current !== null && deniedAt.current !== epoch) {
      deniedAt.current = null;
      setRetryKey((n) => n + 1);
    }
  }, [epoch]);
  const markDenied = (error: { code?: string }) => {
    if (error?.code === 'permission-denied') deniedAt.current = readTokenEpoch();
  };
  return [retryKey, markDenied];
}

/**
 * Top-level collections that are NOT tenant-scoped and must never have an orgId
 * filter injected: the org registry and per-user notifications (already scoped
 * by uid). Everything else top-level is org-owned. (Cross-org reads for the
 * platform owner, e.g. feedback triage, use dedicated queries, not this hook.)
 * The mail queues are server-only — rules deny every client read.
 */
const NON_ORG_SCOPED = new Set(['orgs', 'notifications', 'defaultCurricula', 'documentAssignments']);
// Org-owned SUBCOLLECTIONS (academies/{id}/roster, etc.). Their list reads must
// also be filtered by orgId — a subcollection list query with no orgId filter is
// denied ENTIRELY by Firestore if any sibling doc fails the per-doc inOrg rule
// (e.g. one org-less leftover), which silently empties the whole list. Filtering
// makes Firestore evaluate the rule only on matching docs (excluding the rest).
const ORG_SCOPED_SUBCOLLECTIONS = new Set(['roster', 'reports', 'signups', 'attendance']);

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
  const { orgId, loading: authLoading } = useAuth();
  const [retryKey, markDenied] = useRetryAfterDenied();

  // Tenant isolation: top-level org-owned collections are filtered to the
  // caller's org. LIVE (post-Phase-5) — rules require docId/orgId == the caller's
  // org claim, so an org-less client read is denied, not silently global.
  // Subcollections (e.g. academies/{id}/roster) inherit their parent's org and
  // are not filtered here.
  const segments = path ? path.split('/').filter(Boolean) : [];
  const lastSeg = segments[segments.length - 1];
  // Org-owned top-level collections AND org-owned subcollections (odd segment
  // count) need the orgId filter.
  const needsOrgScope =
    !!path &&
    ((segments.length === 1 && !NON_ORG_SCOPED.has(segments[0])) ||
      (segments.length >= 3 && segments.length % 2 === 1 && ORG_SCOPED_SUBCOLLECTIONS.has(lastSeg)));
  const orgScope = needsOrgScope && orgId ? orgId : null;
  // An org-scoped collection has no rules-provable read without the orgId filter,
  // so DON'T fire the query until orgId is known — otherwise every cold load
  // throws a permissions error while auth is still resolving. Hold `loading`
  // while auth resolves; once resolved-but-org-less, return empty.
  const blockedOnOrg = needsOrgScope && !orgId;

  const q: Query | null = useMemo(
    () => {
      if (!path || blockedOnOrg) return null;
      const all = orgScope ? [where('orgId', '==', orgScope), ...constraints] : constraints;
      return query(collection(db, path), ...all);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, orgScope, blockedOnOrg, ...deps]
  );

  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: blockedOnOrg && authLoading, error: null });
      return;
    }
    // Drop the PREVIOUS query's rows while the new one loads. Keeping them
    // showed e.g. class A's cadets under a freshly selected class B until the
    // first snapshot landed — long enough to pick the wrong record.
    setState({ data: [], loading: true, error: null });
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
        markDenied(error);
        setState({ data: [], loading: false, error });
      }
    );
    return unsub;
    // `path` only feeds the log line, and `markDenied` only touches a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, blockedOnOrg, authLoading, retryKey]);

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
  const [retryKey, markDenied] = useRetryAfterDenied();

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    // Same as useCollection: never show the previous path's document under
    // the new one (route param change) while the new snapshot is in flight.
    setState({ data: null, loading: true, error: null });
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
        markDenied(error);
        setState({ data: null, loading: false, error });
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, retryKey]);

  return state;
}

/** Generate a short random id for role slots etc. (not a Firestore doc id). */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Per-org config doc path. `settings`/`reportConfig` are one doc per tenant
 * (doc id == orgId). The 'global' fallback is a DEAD path post-Phase-5: rules
 * deny every client read/write of the legacy 'global' doc, so a caller without
 * an orgId simply gets permission-denied. It only keeps the return type a plain
 * string; pass `orgId ? orgConfigPath(...) : null` to useDoc to skip the read.
 */
export const orgConfigPath = (coll: 'settings' | 'reportConfig', orgId?: string | null): string =>
  `${coll}/${orgId || 'global'}`;
