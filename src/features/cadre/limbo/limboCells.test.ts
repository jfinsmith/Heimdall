import { describe, expect, it } from 'vitest';
import { bulkCellPatch, dayKeysInRange, daySpan, nonEmptyCells } from './limboCells';

describe('daySpan', () => {
  it('counts both ends', () => {
    expect(daySpan('2026-11-09', '2026-11-09')).toBe(1);
    expect(daySpan('2026-11-09', '2026-11-13')).toBe(5);
  });
  it('is 0 for a reversed, blank or invalid range', () => {
    expect(daySpan('2026-11-10', '2026-11-09')).toBe(0);
    expect(daySpan('', '2026-11-09')).toBe(0);
    expect(daySpan('2026-11-09', 'nope')).toBe(0);
  });
  it('spans a year end and a DST change without drifting', () => {
    expect(daySpan('2026-12-28', '2027-01-03')).toBe(7);
    // US DST ends 2026-11-01 and starts 2027-03-14 (a 25 h and a 23 h day).
    expect(daySpan('2026-10-31', '2026-11-02')).toBe(3);
    expect(daySpan('2027-03-13', '2027-03-15')).toBe(3);
  });
});

describe('dayKeysInRange', () => {
  it('lists local yyyy-mm-dd keys across a year end', () => {
    expect(dayKeysInRange('2026-12-30', '2027-01-02', false)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
  it('skips Saturday and Sunday when asked', () => {
    // 2026-11-13 is a Friday; 11-14/15 the weekend; 11-16 a Monday.
    expect(dayKeysInRange('2026-11-13', '2026-11-16', true)).toEqual(['2026-11-13', '2026-11-16']);
  });
  it('is EMPTY for a weekend-only range with weekdays only', () => {
    expect(dayKeysInRange('2026-11-14', '2026-11-15', true)).toEqual([]);
    expect(dayKeysInRange('2026-11-14', '2026-11-14', true)).toEqual([]);
  });
  it('does not repeat or skip a day over a DST change', () => {
    expect(dayKeysInRange('2026-10-31', '2026-11-02', false)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dayKeysInRange('2027-03-13', '2027-03-15', false)).toEqual(['2027-03-13', '2027-03-14', '2027-03-15']);
  });
});

describe('bulkCellPatch', () => {
  it('assigns the value to every cadet on every day', () => {
    expect(bulkCellPatch(['a', 'b'], ['2026-11-09', '2026-11-10'], 'Range')).toEqual({
      a: { '2026-11-09': 'Range', '2026-11-10': 'Range' },
      b: { '2026-11-09': 'Range', '2026-11-10': 'Range' },
    });
  });
  it('builds no rows at all when there are no days', () => {
    expect(bulkCellPatch(['a', 'b'], [], 'Range')).toEqual({});
  });
});

describe('nonEmptyCells', () => {
  // setDoc(merge) treats an empty map as "overwrite this field with {}" — an
  // empty patch must become "no cells key at all", never `cells: {}`.
  it('returns undefined for a missing or empty patch', () => {
    expect(nonEmptyCells(undefined)).toBeUndefined();
    expect(nonEmptyCells({})).toBeUndefined();
    expect(nonEmptyCells({ a: {} })).toBeUndefined();
  });
  it('drops empty cadet rows and keeps the rest', () => {
    expect(nonEmptyCells({ a: {}, b: { '2026-11-09': 'TDY' } })).toEqual({ b: { '2026-11-09': 'TDY' } });
  });
});
