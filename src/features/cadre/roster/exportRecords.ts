/**
 * Structured cadet-records export (item 10). One row per cadet: identity +
 * outcome + class standing + attended hours + per-tested-course result. Pure —
 * the caller supplies the attended-hours map (summed from the attendance
 * subcollection) so this stays unit-testable and free of Firestore.
 */
import type { CurriculumCourse, RosterMemberDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { agencyLabel, courseKey, courseResult, effectiveScore, gradedCourses, memberStanding } from './rosterShared';

const RESULT_LABEL: Record<string, string> = {
  pass: 'Pass', fail: 'Fail', na: 'N/A', xo: 'XO', wd: 'WD', pending: '',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'In progress', graduated: 'Graduated', withdrawn: 'Withdrawn', dismissed: 'Dismissed',
};

export function buildCadetRecords(
  members: WithId<RosterMemberDoc>[],
  courses: CurriculumCourse[],
  attendedHours: Map<string, number>,
): { headers: string[]; rows: (string | number)[][] } {
  const graded = gradedCourses(courses);
  const idxById = new Map(graded.map((c, i) => [courseKey(c), i] as const));
  const headers = [
    'No', 'Name', 'Agency', 'CJIS', 'Student ID', 'Email', 'Phone',
    'Status', 'Avg %', 'Letter', 'Attended hrs',
    ...graded.map((c) => `${c.cjk ? `${c.cjk} ` : ''}${c.name}`),
  ];
  const rows = members
    .filter((m) => !m.blockTaker)
    .map((m): (string | number)[] => {
      const standing = memberStanding(m, courses);
      return [
        m.no ?? '',
        m.fullName,
        agencyLabel(m),
        m.cjis ?? '',
        m.studentId ?? '',
        m.email ?? '',
        m.phone ?? '',
        STATUS_LABEL[m.status] ?? m.status,
        standing.avgPct != null ? standing.avgPct.toFixed(1) : '',
        standing.letter ?? '',
        attendedHours.get(m.id) ?? '',
        ...graded.map((c, i) => {
          const res = courseResult(m, c, idxById, i);
          if (res === 'pending') return '';
          const eff = effectiveScore(m.grades?.[courseKey(c)]);
          return `${RESULT_LABEL[res] ?? res}${eff != null ? ` (${eff})` : ''}`.trim();
        }),
      ];
    });
  return { headers, rows };
}
