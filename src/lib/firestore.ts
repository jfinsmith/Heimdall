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
  Query,
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

export type WithId<T> = T & { id: string };

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const q: Query | null = useMemo(
    () => (path ? query(collection(db, path), ...constraints) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps]
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
      (error) => setState({ data: [], loading: false, error })
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
      (error) => setState({ data: null, loading: false, error })
    );
    return unsub;
  }, [path]);

  return state;
}

/** Generate a short random id for role slots etc. (not a Firestore doc id). */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
