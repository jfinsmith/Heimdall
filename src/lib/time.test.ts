/** Unit tests for the session-duration guard used across all create/edit paths. */
import { describe, it, expect } from 'vitest';
import { addDays, combineDateTime, fmtTime, hoursBetween, isSameLocalDay, isValidDuration, overlaps, toDateInputValue, toTimeInputValue } from './time';

const at = (h: number, m = 0) => new Date(2026, 5, 1, h, m, 0);

describe('isValidDuration', () => {
  it('accepts a normal positive span', () => {
    expect(isValidDuration(at(8), at(16))).toBe(true);
  });

  it('accepts a one-minute span', () => {
    expect(isValidDuration(at(8, 0), at(8, 1))).toBe(true);
  });

  it('rejects a zero-length span (end === start) — the FullCalendar null-end crash case', () => {
    expect(isValidDuration(at(8), at(8))).toBe(false);
  });

  it('rejects an inverted span (end before start)', () => {
    expect(isValidDuration(at(16), at(8))).toBe(false);
  });
});

describe('local date/time helpers (no UTC drift)', () => {
  it('fmtTime is 24-hour and prints midnight as 00, never 24', () => {
    expect(fmtTime(new Date(2026, 5, 1, 0, 5))).toBe('00:05');
    expect(fmtTime(new Date(2026, 5, 1, 13, 30))).toBe('13:30');
  });
  it('combineDateTime reads the date and time as LOCAL wall-clock', () => {
    const d = combineDateTime('2026-11-09', '07:30');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 9, 7, 30]);
  });
  it('input values round-trip through combineDateTime, including late evening', () => {
    const d = new Date(2026, 11, 31, 23, 45);
    expect(toDateInputValue(d)).toBe('2026-12-31');
    expect(toTimeInputValue(d)).toBe('23:45');
    expect(combineDateTime(toDateInputValue(d), toTimeInputValue(d)).getTime()).toBe(d.getTime());
  });
  it('addDays steps calendar days across a DST change without drifting the clock time', () => {
    const d = addDays(new Date(2026, 2, 7, 8, 0), 1); // US spring-forward is Mar 8 2026
    expect([d.getDate(), d.getHours()]).toEqual([8, 8]);
    expect(toDateInputValue(addDays(new Date(2026, 11, 31, 8), 1))).toBe('2027-01-01');
  });
  it('isSameLocalDay / overlaps / hoursBetween', () => {
    expect(isSameLocalDay(new Date(2026, 5, 1, 0, 0), new Date(2026, 5, 1, 23, 59))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 5, 1, 23, 59), new Date(2026, 5, 2, 0, 0))).toBe(false);
    // Back-to-back blocks do not overlap ([start, end) windows).
    expect(overlaps(at(8), at(10), at(10), at(12))).toBe(false);
    expect(overlaps(at(8), at(10, 1), at(10), at(12))).toBe(true);
    expect(hoursBetween(at(8), at(16, 30))).toBe(8.5);
    expect(hoursBetween(at(8), at(8, 50))).toBe(0.75);
  });
});
