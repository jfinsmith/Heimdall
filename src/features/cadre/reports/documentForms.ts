/**
 * Phase 12 — in-app document builder. A `documentForms` doc is an org-scoped,
 * admin/owner-authored document (fields + paragraph/locked-clause blocks) that
 * renders through the SAME MemoDocument engine as the code-defined documents
 * (Phase 10/11). Stored in the top-level `documentForms` collection (auto
 * org-scoped by useCollection); converted to a ReportType for the existing
 * filing + rendering paths.
 */
import { useMemo } from 'react';
import { useCollection, type WithId } from '../../../lib/firestore';
import type { DocBlock, ReportField, ReportType } from './reportTypes';
import { GENERAL_CATEGORY, type EffectiveReportType } from './reportConfig';

export interface DocumentFormDoc {
  /** Tenant (orgs/{orgId}); stamped on create. */
  orgId?: string;
  name: string;
  purpose: string;
  reSubject: string;
  /** Report category it appears under on the roster Reports tab (e.g. 'general'). */
  category: string;
  fields: ReportField[];
  appliesTo: 'cadet' | 'file' | 'general';
  headerFields: { label: string; value: string }[];
  blocks: DocBlock[];
  signerLine: string;
  acknowledgment?: string;
  ackSignerLabel?: string;
  distribution?: string[];
  active: boolean;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Convert a stored document form into the ReportType the engine consumes. */
export function documentFormToReportType(d: WithId<DocumentFormDoc>): ReportType {
  return {
    id: d.id,
    name: d.name,
    purpose: d.purpose,
    reSubject: d.reSubject,
    fields: d.fields ?? [],
    orgScope: d.orgId,
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

/** Live org-scoped custom document forms (active only), as EffectiveReportTypes
 *  (the category carried from the doc so they slot into the right Reports-tab
 *  section). The collection is auto org-scoped by useCollection. */
export function useCustomReportTypes(): { types: EffectiveReportType[]; loading: boolean } {
  const { data, loading } = useCollection<DocumentFormDoc>('documentForms');
  const types = useMemo<EffectiveReportType[]>(
    () =>
      data
        .filter((d) => d.active !== false)
        .map((d) => ({ ...documentFormToReportType(d), category: d.category || GENERAL_CATEGORY })),
    [data]
  );
  return { types, loading };
}
