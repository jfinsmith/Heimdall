/**
 * Curriculum resolution — the single source of truth for "which courses/hours
 * does this discipline have." The five FDLE platform programs are owner-managed
 * in `defaultCurricula` and surfaced read-only to every org; an org may add its
 * own curricula in `curricula`. Both the per-academy lookup and the pickers route
 * through here so the whole app pulls from one place.
 */
import { useDoc, useCollection, type WithId } from './firestore';
import type { CurriculumDoc } from '../types';

/**
 * The five platform FDLE programs (owner-managed in `defaultCurricula`, read-only
 * across every org). MUST match the keys in features/admin/fdleCurricula.ts.
 */
export const PLATFORM_CURRICULUM_KEYS = ['le_brt', 'co_brt', 'co_to_le', 'le_to_co', 'eot'] as const;
const PLATFORM_SET = new Set<string>(PLATFORM_CURRICULUM_KEYS);

/** Base curriculum key from a discipline id — strips the `{orgId}__` namespace. */
export function baseCurriculumKey(disciplineId: string): string {
  const i = disciplineId.indexOf('__');
  return i === -1 ? disciplineId : disciplineId.slice(i + 2);
}

/** True if a discipline id refers to one of the five platform FDLE programs. */
export function isPlatformCurriculum(disciplineId: string): boolean {
  return PLATFORM_SET.has(baseCurriculumKey(disciplineId));
}

/**
 * Resolve one academy's `discipline` to its curriculum doc. Platform programs
 * come from `defaultCurricula` (one truth across orgs); everything else is the
 * org's own `curricula` doc. Handles legacy academies whose discipline still
 * stores a namespaced/bare platform id (e.g. `phsc__le_brt` or `le_brt`).
 *
 * Transition-safe: for a platform discipline it watches BOTH the platform doc and
 * any legacy org copy, preferring the platform program but falling back to the org
 * copy until the owner has loaded the platform defaults — so existing academies
 * never lose their curriculum mid-rollout.
 */
export function useCurriculum(disciplineId?: string | null) {
  const isPlat = !!disciplineId && isPlatformCurriculum(disciplineId);
  const platform = useDoc<CurriculumDoc>(isPlat ? `defaultCurricula/${baseCurriculumKey(disciplineId!)}` : null);
  const org = useDoc<CurriculumDoc>(disciplineId ? `curricula/${disciplineId}` : null);
  if (!isPlat) return org;
  return {
    data: platform.data ?? org.data,
    loading: platform.loading || org.loading,
    error: platform.error,
  };
}

export interface AllCurricula {
  /** The five platform programs (read-only, owner-managed). */
  platform: WithId<CurriculumDoc>[];
  /** This org's own additional curricula. */
  org: WithId<CurriculumDoc>[];
  /** Platform programs first, then org additions. */
  all: WithId<CurriculumDoc>[];
  loading: boolean;
}

/**
 * All curricula available to the current org: the five platform programs plus the
 * org's own additions. Any org doc that shadows a platform key is dropped so the
 * platform stays the single source of truth (and never shows as a duplicate).
 */
export function useAllCurricula(): AllCurricula {
  const platform = useCollection<CurriculumDoc>('defaultCurricula');
  const org = useCollection<CurriculumDoc>('curricula');
  // Which platform programs are actually loaded — an org copy of a platform key is
  // dropped once its platform program exists (single truth), but kept as a
  // fallback while the owner hasn't loaded the platform defaults yet.
  const loaded = new Set(platform.data.map((c) => c.key || baseCurriculumKey(c.id)));
  const orgExtras = org.data.filter((c) => {
    const bk = c.key || baseCurriculumKey(c.id);
    return PLATFORM_SET.has(bk) ? !loaded.has(bk) : true;
  });
  return {
    platform: platform.data,
    org: orgExtras,
    all: [...platform.data, ...orgExtras],
    loading: platform.loading || org.loading,
  };
}
