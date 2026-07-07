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

/** Warning count + weighted demerit points (A=1,B=3,C=6,D=12) for a member. */
const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** "Jane Q Smith" → "Smith, Jane Q" (suffix-aware: "John Smith Jr." → "Smith Jr., John"). */
export function lastFirst(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  if (parts.length < 2) return name ?? '';
  let lastIdx = parts.length - 1;
  if (NAME_SUFFIX.test(parts[lastIdx]) && lastIdx >= 2) lastIdx -= 1;
  return `${parts.slice(lastIdx).join(' ')}, ${parts.slice(0, lastIdx).join(' ')}`;
}

/**
 * Canonical roster ordering: alphabetical by LAST name; withdrawn/dismissed
 * members sink to the bottom (alphabetical there too). Roster `no` stays a
 * stable intake-order identifier and only tie-breaks identical names.
 */
export function rosterCompare(a: Pick<RosterMemberDoc, 'fullName' | 'status' | 'no'>, b: Pick<RosterMemberDoc, 'fullName' | 'status' | 'no'>): number {
  const termA = a.status === 'withdrawn' || a.status === 'dismissed' ? 1 : 0;
  const termB = b.status === 'withdrawn' || b.status === 'dismissed' ? 1 : 0;
  if (termA !== termB) return termA - termB;
  return (
    lastFirst(a.fullName).localeCompare(lastFirst(b.fullName), undefined, { sensitivity: 'base' }) ||
    (a.no ?? 0) - (b.no ?? 0)
  );
}

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
 * Stable key for a course in the grades / standing / withdrawal maps — the CJK
 * number when present (survives a course RENAME, so grades aren't orphaned), else
 * the name. Used everywhere a course is keyed in member data.
 */
export function courseKey(course: Pick<CurriculumCourse, 'cjk' | 'name'>): string {
  return (course.cjk && course.cjk.trim()) || course.name;
}

/**
 * Effective numeric score recorded for a course, or null. A passing primary
 * stands as-is. If the primary FAILED (< 80), a re-examination can only restore
 * the score up to the pass mark — the recorded score is CAPPED at 80 no matter
 * what the cadet scores on the re-exam (a re-exam that still fails keeps its
 * actual sub-80 score). The class-standing average is the mean of these.
 */
export function effectiveScore(cell?: GradeCell): number | null {
  if (!cell) return null;
  const primary = typeof cell.score === 'number' && Number.isFinite(cell.score) ? cell.score : null;
  if (primary != null && primary >= PASS_MARK) return primary;
  if (typeof cell.reexamScore === 'number' && Number.isFinite(cell.reexamScore)) {
    return Math.min(cell.reexamScore, PASS_MARK); // re-exam caps at the pass mark
  }
  return primary;
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
  const cell = member.grades?.[courseKey(course)];
  if (cell?.status === 'na') return 'na';
  if (cell?.status === 'xo') return 'xo'; // crossover / Blackbird — exempt, not graded
  const primary = cell?.score;
  if (primary == null && cell?.status !== 'co') return 'pending';
  if (cell?.status === 'co') return 'pending';
  if ((primary ?? 0) >= PASS_MARK) return 'pass';
  // Failed the primary written exam — resolve the single lifeline.
  if (course.highLiability) {
    // A lifeline that's been ELECTED but not yet resolved (no score / result
    // recorded) is still pending — not an automatic fail the moment staff note
    // "remediation scheduled".
    if (cell?.lifeline === 'reexam') return cell.reexamScore == null ? 'pending' : cell.reexamScore >= PASS_MARK ? 'pass' : 'fail';
    if (cell?.lifeline === 'remediation') return cell.remediation == null ? 'pending' : cell.remediation === 'pass' ? 'pass' : 'fail';
    return 'pending'; // failed, lifeline not yet used
  }
  if (cell?.reexamScore != null) return cell.reexamScore >= PASS_MARK ? 'pass' : 'fail';
  if (cell?.reexamIneligible) return 'fail'; // re-exam already spent elsewhere — the EOC score stands as final
  return 'pending'; // failed primary, reexam available
}

/** Class-standing rollup + warnings for one member. */
export function memberStanding(
  member: RosterMemberDoc,
  courses: CurriculumCourse[]
): { avgPct: number | null; letter: string | null; nonHlFails: number; hlFails: number; warnings: string[] } {
  const graded = gradedCourses(courses);
  const idxById = new Map(graded.map((c, i) => [courseKey(c), i] as const));
  const scores: number[] = [];
  let nonHlFails = 0;
  let hlFails = 0;
  graded.forEach((c, i) => {
    const eff = effectiveScore(member.grades?.[courseKey(c)]);
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
