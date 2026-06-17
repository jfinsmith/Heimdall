/**
 * Shared roster helpers — agency labels, discipline tallies, and the FDLE
 * grade-outcome logic (computed, never auto-enforced: the UI flags, staff decide).
 */
import type { CurriculumCourse, GradeCell, RosterMemberDoc, ViolationEntry } from '../../../types';
import { DEMERIT_POINTS, letterFor, PASS_MARK, ROSTER_AGENCIES } from '../../../types';

export function agencyLabel(m: Pick<RosterMemberDoc, 'agency' | 'agencyOther'>): string {
  if (m.agency === 'Other') return m.agencyOther?.trim() || 'Other';
  return ROSTER_AGENCIES.find((a) => a.key === m.agency)?.label ?? m.agency;
}

/** Warning count + weighted demerit points (A=1,B=2,C=3,D=4) for a member. */
export function disciplineTally(violations: ViolationEntry[] = []) {
  let warnings = 0;
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let points = 0;
  for (const v of violations) {
    if (v.level === 'warning') warnings++;
    else if (v.level in counts) {
      counts[v.level]++;
      points += DEMERIT_POINTS[v.level];
    }
  }
  return { warnings, counts, points };
}

export type CourseResult = 'pass' | 'fail' | 'na' | 'xo' | 'wd' | 'pending';

/** Tested curriculum courses in academy order. */
export function gradedCourses(courses: CurriculumCourse[] = []): CurriculumCourse[] {
  return courses.filter((c) => c.tested);
}

/**
 * Effective numeric score for averaging (best of primary / reexam), or null.
 * The class-standing average is the mean of recorded scores; a failing score is
 * intentionally included (it lowers the average) — pass/fail and exit/dismissal
 * status is surfaced separately via memberStanding().warnings.
 */
export function effectiveScore(cell?: GradeCell): number | null {
  if (!cell) return null;
  const nums = [cell.score, cell.reexamScore].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return nums.length ? Math.max(...nums) : null;
}

/**
 * Outcome of one tested course for one member. `withdrawnAfter` is the course
 * name the cadet withdrew after (courses at/after it read WD).
 */
export function courseResult(
  member: RosterMemberDoc,
  course: CurriculumCourse,
  courseIndexById: Map<string, number>,
  thisIndex: number
): CourseResult {
  if (member.status === 'withdrawn') {
    const wIdx = member.withdrawnAfterCourse ? courseIndexById.get(member.withdrawnAfterCourse) ?? -1 : -1;
    if (wIdx < 0 || thisIndex > wIdx) return 'wd';
  }
  const cell = member.grades?.[course.name];
  if (cell?.status === 'na') return 'na';
  if (cell?.status === 'xo') return 'xo'; // crossover / Blackbird — exempt, not graded
  const primary = cell?.score;
  if (primary == null && cell?.status !== 'co') return 'pending';
  if (cell?.status === 'co') return 'pending';
  if ((primary ?? 0) >= PASS_MARK) return 'pass';
  // Failed the primary written exam — resolve the single lifeline.
  if (course.highLiability) {
    if (cell?.lifeline === 'reexam') return (cell.reexamScore ?? 0) >= PASS_MARK ? 'pass' : 'fail';
    if (cell?.lifeline === 'remediation') return cell.remediation === 'pass' ? 'pass' : 'fail';
    return 'pending'; // failed, lifeline not yet used
  }
  if (cell?.reexamScore != null) return cell.reexamScore >= PASS_MARK ? 'pass' : 'fail';
  return 'pending'; // failed primary, reexam available
}

/** Class-standing rollup + warnings for one member. */
export function memberStanding(
  member: RosterMemberDoc,
  courses: CurriculumCourse[]
): { avgPct: number | null; letter: string | null; nonHlFails: number; hlFails: number; warnings: string[] } {
  const graded = gradedCourses(courses);
  const idxById = new Map(graded.map((c, i) => [c.name, i] as const));
  const scores: number[] = [];
  let nonHlFails = 0;
  let hlFails = 0;
  graded.forEach((c, i) => {
    const eff = effectiveScore(member.grades?.[c.name]);
    if (eff != null) scores.push(eff);
    const res = courseResult(member, c, idxById, i);
    if (res === 'fail') c.highLiability ? hlFails++ : nonHlFails++;
  });
  const avgPct = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null;
  const warnings: string[] = [];
  if (hlFails > 0) warnings.push(`Failed ${hlFails} high-liability block${hlFails > 1 ? 's' : ''} — academic-exit review.`);
  if (nonHlFails >= 2) warnings.push(`${nonHlFails} non-HL course failures — dismissal review.`);
  else if (nonHlFails === 1) warnings.push('1 non-HL failure — one more failure means dismissal.');
  return { avgPct, letter: avgPct == null ? null : letterFor(avgPct), nonHlFails, hlFails, warnings };
}

/** Color classes for a grade cell by result. */
export function resultClasses(res: CourseResult): string {
  switch (res) {
    case 'pass':
      return 'bg-green-50 text-green-800';
    case 'fail':
      return 'bg-red-100 text-red-800 font-semibold';
    case 'na':
      return 'bg-slate-100 text-slate-500';
    case 'xo':
      return 'bg-sky-50 text-sky-700';
    case 'wd':
      return 'bg-slate-200 text-slate-400';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}
