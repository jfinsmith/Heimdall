/**
 * Report configuration overlay. The form fields and verbatim letter body live
 * in the code registry (reportTypes.tsx) and are NOT editable. Admins can,
 * however, rename a report and assign it to a custom category (LE, CO, NMT,
 * ARGUS…) via the `reportConfig/global` Firestore doc — this merges the two.
 *
 * Disciplines (curricula) then choose report *categories*, and a class offers
 * every report whose effective category is selected.
 */
import type { ReportCategory, ReportConfigDoc } from '../../../types';
import { REPORT_TYPES, type ReportType } from './reportTypes';

export const DEFAULT_REPORT_CATEGORIES: ReportCategory[] = [
  { key: 'le', label: 'Law Enforcement' },
  { key: 'co', label: 'Corrections' },
  { key: 'nmt', label: 'New Member Training' },
  { key: 'argus', label: 'ARGUS' },
];

/** The four built-in forms are Law Enforcement until an admin reassigns them. */
const DEFAULT_CATEGORY_FOR: Record<string, string> = {
  exam_failure: 'le',
  proficiency_fail: 'le',
  exam_course_fail: 'le',
  academy_dismissal: 'le',
};

export type EffectiveReportType = ReportType & { category: string };

/** Categories to show (admin list when set, else the built-in defaults). */
export function reportCategoriesOf(config: ReportConfigDoc | null | undefined): ReportCategory[] {
  return config?.categories?.length ? config.categories : DEFAULT_REPORT_CATEGORIES;
}

/** Code registry merged with admin name/category overrides. */
export function effectiveReportTypes(config: ReportConfigDoc | null | undefined): EffectiveReportType[] {
  const overrides = config?.overrides ?? {};
  return REPORT_TYPES.map((t) => ({
    ...t,
    name: overrides[t.id]?.name?.trim() || t.name,
    category: overrides[t.id]?.categoryKey || DEFAULT_CATEGORY_FOR[t.id] || DEFAULT_REPORT_CATEGORIES[0].key,
  }));
}
