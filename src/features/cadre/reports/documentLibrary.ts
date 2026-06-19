/**
 * Owner-managed document library (unified-documents redesign).
 *
 * A library form is GENERAL (offered to every org) or SPECIALIZED (assigned to
 * specific orgs). Stored in the top-level `documentLibrary` collection, which is
 * NOT tenant-scoped (no orgId) — `documentLibrary` is in NON_ORG_SCOPED so
 * useCollection never injects an orgId filter. Read access is gated by
 * availability/orgIds in firestore.rules; only the platform owner may write.
 *
 * Forms offered to a class = built-in GENERAL code forms (reportTypes.tsx) +
 * library general forms, with the curriculum's per-discipline overrides applied
 * (disable / swap with a specialized form / add a specialized form).
 */
import { useMemo } from 'react';
import { where, type Timestamp } from 'firebase/firestore';
import { useCollection, type WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import type { CurriculumDoc } from '../../../types';
import type { ReportField, DocBlock, ReportType } from './reportTypes';

export interface LibraryFormDoc {
  name: string;
  purpose: string;
  reSubject: string;
  /** 'letter' renders through the MemoDocument engine; 'attendance'/'signin'
   *  (Phase 2) select a coded roster layout. */
  kind: 'letter' | 'attendance' | 'signin';
  availability: 'general' | 'specialized';
  /** Specialized only — the orgs this form is assigned to. */
  orgIds?: string[];
  /** Optional base/general form id this is a variant of (for override grouping). */
  baseFormId?: string;
  // ── Letter spec (kind:'letter') ──
  appliesTo: 'cadet' | 'file' | 'general';
  fields: ReportField[];
  headerFields: { label: string; value: string }[];
  blocks: DocBlock[];
  signerLine: string;
  acknowledgment?: string;
  ackSignerLabel?: string;
  distribution?: string[];
  active: boolean;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Convert a stored library letter into the ReportType the engine consumes. */
export function libraryFormToReportType(d: WithId<LibraryFormDoc>): ReportType {
  return {
    id: d.id,
    name: d.name,
    purpose: d.purpose,
    reSubject: d.reSubject,
    fields: d.fields ?? [],
    document: {
      appliesTo: d.appliesTo,
      headerFields: d.headerFields ?? [],
      blocks: d.blocks ?? [],
      signerLine: d.signerLine,
      acknowledgment: d.acknowledgment || undefined,
      ackSignerLabel: d.ackSignerLabel || undefined,
      distribution: d.distribution,
    },
  };
}

/** Owner console: the entire library. Allowed for the platform owner only
 *  (rules); documentLibrary is exempt from orgId injection. */
export function useOwnerLibrary(): { forms: WithId<LibraryFormDoc>[]; loading: boolean } {
  const { data, loading } = useCollection<LibraryFormDoc>('documentLibrary');
  return { forms: data, loading };
}

/** Staff: the library forms available to THIS org — general (all) + specialized
 *  assigned to the org. Two constrained subscriptions merged; each satisfies the
 *  read rule, so neither hits list-denial. Active only. */
export function useOrgLibraryForms(): { forms: WithId<LibraryFormDoc>[]; loading: boolean } {
  const { orgId } = useAuth();
  const general = useCollection<LibraryFormDoc>('documentLibrary', [where('availability', '==', 'general')]);
  const specialized = useCollection<LibraryFormDoc>(
    orgId ? 'documentLibrary' : null,
    [where('orgIds', 'array-contains', orgId ?? '__none__')],
    [orgId]
  );
  const forms = useMemo(() => {
    const byId = new Map<string, WithId<LibraryFormDoc>>();
    for (const f of [...general.data, ...specialized.data]) {
      if (f.active !== false) byId.set(f.id, f);
    }
    return [...byId.values()];
  }, [general.data, specialized.data]);
  return { forms, loading: general.loading || specialized.loading };
}

/**
 * The letter/memo forms offered to a class: built-in general code forms + library
 * general letters, minus the curriculum's disabled forms, with each base form
 * swapped for its specialized override, plus explicitly added specialized forms.
 * (Roster kinds are handled separately in Phase 2.)
 */
export function offeredLetterForms(
  curriculum: CurriculumDoc | null | undefined,
  codeGeneral: ReportType[],
  library: WithId<LibraryFormDoc>[]
): ReportType[] {
  const letters = library.filter((f) => (f.kind ?? 'letter') === 'letter');
  const libById = new Map(letters.map((f) => [f.id, f]));
  const base: ReportType[] = [
    ...codeGeneral,
    ...letters.filter((f) => f.availability === 'general').map(libraryFormToReportType),
  ];
  const disabled = new Set(curriculum?.disabledForms ?? []);
  const overrides = curriculum?.formOverrides ?? {};
  const used = new Set<string>();
  const result: ReportType[] = [];
  for (const f of base) {
    if (disabled.has(f.id)) continue;
    const overrideId = overrides[f.id];
    const target = overrideId ? libById.get(overrideId) : undefined;
    if (target) {
      // Guard against the same specialized form being mapped onto two base forms.
      if (!used.has(target.id)) {
        result.push(libraryFormToReportType(target));
        used.add(target.id);
      }
    } else {
      result.push(f);
    }
  }
  for (const id of curriculum?.addedForms ?? []) {
    if (used.has(id)) continue;
    const f = libById.get(id);
    if (f) {
      result.push(libraryFormToReportType(f));
      used.add(id);
    }
  }
  return result;
}
