/**
 * Unit tests for the FDLE grade engine + discipline math — the trickiest
 * pure logic in the roster (weighted demerits, pass/fail, HL reexam/remediation,
 * withdrawal handling). No emulator required.
 */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { CurriculumCourse, GradeCell, RosterMemberDoc, ViolationEntry } from '../../../types';
import { disciplineTally, effectiveScore, courseResult, memberStanding, courseKey } from './rosterShared';

const ts = (y = 2026, m = 5, d = 1) => Timestamp.fromDate(new Date(y, m - 1, d, 12));

function member(over: Partial<RosterMemberDoc> = {}): RosterMemberDoc {
  return {
    no: 1, fullName: 'Test Cadet', agency: 'PSO', status: 'active',
    createdAt: ts(), updatedAt: ts(), ...over,
  } as RosterMemberDoc;
}
const v = (level: ViolationEntry['level'], type: ViolationEntry['type'] = 'Tardy'): ViolationEntry => ({
  id: Math.random().toString(36).slice(2), date: ts(), type, level,
});
const course = (name: string, hl = false, tested = true): CurriculumCourse => ({ name, minHours: 8, highLiability: hl, tested });

describe('courseKey (stable grade keys)', () => {
  it('uses the CJK number when present (survives a rename), else the name', () => {
    expect(courseKey({ cjk: 'CJK0040', name: 'Firearms' })).toBe('CJK0040');
    expect(courseKey({ name: 'Guest Speaker' })).toBe('Guest Speaker');
  });
  it("grades keyed by CJK are still found after the course is renamed", () => {
    const m = member({ grades: { CJK0040: { score: 92 } } });
    const renamed: CurriculumCourse[] = [{ cjk: 'CJK0040', name: 'Criminal Justice Firearms', minHours: 80, highLiability: true, tested: true }];
    expect(memberStanding(m, renamed).avgPct).toBe(92); // found via CJK despite the new name
  });
});

describe('disciplineTally', () => {
  it('counts warnings separately from demerit points', () => {
    const t = disciplineTally([v('warning'), v('warning'), v('A')]);
    expect(t.warnings).toBe(2);
    expect(t.points).toBe(1);
  });
  it('weights A/B/C/D as 1/3/6/12 (A+B+C = 10)', () => {
    const t = disciplineTally([v('A'), v('B'), v('C')]);
    expect(t.points).toBe(10);
    expect(t.counts).toEqual({ A: 1, B: 1, C: 1, D: 0 });
  });
  it('three same-level demerits add to 3 (3×A)', () => {
    expect(disciplineTally([v('A'), v('A'), v('A')]).points).toBe(3);
  });
  it('demerit D weighs 12 (automatic dismissal)', () => {
    expect(disciplineTally([v('D')]).points).toBe(12);
  });
  it('empty/undefined is clean', () => {
    expect(disciplineTally().points).toBe(0);
    expect(disciplineTally([]).warnings).toBe(0);
  });
});

describe('effectiveScore', () => {
  it('caps a passing re-exam at the pass mark (80); a passing primary stands', () => {
    expect(effectiveScore({ score: 60, reexamScore: 85 })).toBe(80); // re-exam capped at 80
    expect(effectiveScore({ score: 60, reexamScore: 95 })).toBe(80); // any re-exam → max 80
    expect(effectiveScore({ score: 60, reexamScore: 70 })).toBe(70); // re-exam still failing keeps actual
    expect(effectiveScore({ score: 92 })).toBe(92); // passing primary unchanged
  });
  it('returns null when no numeric score', () => {
    expect(effectiveScore({ status: 'na' })).toBeNull();
    expect(effectiveScore(undefined)).toBeNull();
  });
  it('ignores NaN', () => {
    expect(effectiveScore({ score: NaN as unknown as number })).toBeNull();
  });
});

describe('courseResult', () => {
  const courses = [course('Intro'), course('Firearms', true), course('Legal')];
  const idx = new Map(courses.map((c, i) => [c.name, i] as const));
  const res = (m: RosterMemberDoc, name: string) => {
    const i = idx.get(name)!;
    return courseResult(m, courses[i], idx, i);
  };

  it('passes at or above 80, fails below (non-HL)', () => {
    expect(res(member({ grades: { Intro: { score: 80 } } }), 'Intro')).toBe('pass');
    expect(res(member({ grades: { Intro: { score: 79 } } }), 'Intro')).toBe('pending'); // failed primary, reexam still available
    expect(res(member({ grades: { Intro: { score: 79, reexamScore: 70 } } }), 'Intro')).toBe('fail');
    expect(res(member({ grades: { Intro: { score: 79, reexamScore: 88 } } }), 'Intro')).toBe('pass');
  });

  it('N/A and pending', () => {
    expect(res(member({ grades: { Intro: { status: 'na' } } }), 'Intro')).toBe('na');
    expect(res(member({ grades: {} }), 'Intro')).toBe('pending');
  });

  it('non-HL fail marked not-eligible for re-exam is final (fail, not pending)', () => {
    expect(res(member({ grades: { Intro: { score: 70 } } }), 'Intro')).toBe('pending'); // re-exam still available
    expect(res(member({ grades: { Intro: { score: 70, reexamIneligible: true } } }), 'Intro')).toBe('fail');
  });

  it('HL: an ELECTED but unresolved lifeline is still pending, not an automatic fail', () => {
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'reexam' } } }), 'Firearms')).toBe('pending');
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'remediation' } } }), 'Firearms')).toBe('pending');
  });

  it('HL: one lifeline — reexam or remediation, not both', () => {
    const failNoLifeline = member({ grades: { Firearms: { score: 70 } } });
    expect(res(failNoLifeline, 'Firearms')).toBe('pending'); // failed, lifeline not used yet
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'reexam', reexamScore: 85 } } }), 'Firearms')).toBe('pass');
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'reexam', reexamScore: 75 } } }), 'Firearms')).toBe('fail');
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'remediation', remediation: 'pass' } } }), 'Firearms')).toBe('pass');
    expect(res(member({ grades: { Firearms: { score: 70, lifeline: 'remediation', remediation: 'fail' } } }), 'Firearms')).toBe('fail');
  });

  it('withdrawal: courses at/after the withdrawal point read WD, earlier ones keep their grade', () => {
    const m = member({
      status: 'withdrawn',
      withdrawnAfterCourse: 'Firearms',
      grades: { Intro: { score: 90 }, Firearms: { score: 88 } },
    });
    expect(res(m, 'Intro')).toBe('pass'); // before withdrawal point
    expect(res(m, 'Legal')).toBe('wd');   // after withdrawal point
  });
});

describe('memberStanding', () => {
  const courses = [course('Intro'), course('Firearms', true), course('Legal')];

  it('averages recorded scores and assigns a letter', () => {
    const s = memberStanding(member({ grades: { Intro: { score: 96 }, Firearms: { score: 96 }, Legal: { score: 96 } } }), courses);
    expect(s.avgPct).toBe(96);
    expect(s.letter).toBe('A');
  });

  it('counts non-HL vs HL failures and warns at thresholds', () => {
    const m = member({
      grades: {
        Intro: { score: 70, reexamScore: 70 },   // non-HL fail
        Legal: { score: 60, reexamScore: 60 },    // non-HL fail
        Firearms: { score: 70, lifeline: 'reexam', reexamScore: 60 }, // HL fail
      },
    });
    const s = memberStanding(m, courses);
    expect(s.nonHlFails).toBe(2);
    expect(s.hlFails).toBe(1);
    expect(s.warnings.some((w) => /dismissal/i.test(w))).toBe(true);
    expect(s.warnings.some((w) => /high-liability/i.test(w))).toBe(true);
  });

  it('one non-HL failure warns about the next one', () => {
    const s = memberStanding(member({ grades: { Intro: { score: 70, reexamScore: 70 } } }), courses);
    expect(s.nonHlFails).toBe(1);
    expect(s.warnings.some((w) => /one more/i.test(w))).toBe(true);
  });
});
