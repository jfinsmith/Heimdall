/** Unit tests for the cadet-records CSV builder (item 10). Pure — no Firestore. */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { CurriculumCourse, RosterMemberDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { buildCadetRecords } from './exportRecords';

const ts = Timestamp.fromDate(new Date(2026, 0, 1, 12));
const m = (over: Partial<WithId<RosterMemberDoc>> = {}): WithId<RosterMemberDoc> => ({
  id: over.id ?? 'm1', no: 1, fullName: 'Test Cadet', agency: 'PSO', status: 'active',
  createdAt: ts, updatedAt: ts, ...over,
} as WithId<RosterMemberDoc>);
const courses: CurriculumCourse[] = [
  { cjk: 'CJK0040', name: 'Firearms', minHours: 80, highLiability: true, tested: true },
  { name: 'Legal', minHours: 8, tested: true },
];

describe('buildCadetRecords', () => {
  it('emits identity + standing + attended-hours + a column per tested course', () => {
    const hours = new Map([['m1', 712]]);
    const { headers, rows } = buildCadetRecords(
      [m({ status: 'graduated', grades: { CJK0040: { score: 92 }, Legal: { score: 88 } } })],
      courses,
      hours,
    );
    expect(headers).toContain('Attended hrs');
    expect(headers).toContain('CJK0040 Firearms');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row[1]).toBe('Test Cadet');
    expect(row[7]).toBe('Graduated');       // status label
    expect(row[10]).toBe(712);              // attended hours from the map
    expect(row[11]).toBe('Pass (92)');      // Firearms result keyed by CJK
    expect(row[12]).toBe('Pass (88)');      // Legal
  });

  it('excludes block-takers and leaves attended-hours blank when unknown', () => {
    const { rows } = buildCadetRecords(
      [m({ id: 'a', fullName: 'Cadet A' }), m({ id: 'b', fullName: 'Block Taker', blockTaker: true })],
      courses,
      new Map(),
    );
    expect(rows.map((r) => r[1])).toEqual(['Cadet A']);
    expect(rows[0][10]).toBe('');           // no attendance recorded → blank, not 0
  });
});
