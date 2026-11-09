/** 14-day pay periods anchored to Mon Jan 5 2026, plus holiday-pay credit. */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { groupPayPeriods, payPeriodStart, q } from './payPeriods';
import type { SessionDoc } from '../types';
import type { WithId } from './firestore';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const session = (id: string, start: Date, hours: number, status = 'open') =>
  ({ id, start: Timestamp.fromDate(start), hours, status }) as unknown as WithId<SessionDoc>;

describe('payPeriodStart', () => {
  it('the anchor Monday starts its own period, through the second Sunday night', () => {
    expect(ymd(payPeriodStart(new Date(2026, 0, 5)))).toBe('2026-01-05');
    expect(ymd(payPeriodStart(new Date(2026, 0, 18, 23, 59)))).toBe('2026-01-05');
    expect(ymd(payPeriodStart(new Date(2026, 0, 19)))).toBe('2026-01-19');
  });
  it('works backwards from the anchor', () => {
    expect(ymd(payPeriodStart(new Date(2026, 0, 4)))).toBe('2025-12-22');
  });
  it('always returns a local-midnight Monday on the 14-day grid, across DST changes and the 53-week year edge', () => {
    // 2026-03-08 and 2026-11-01 are the US DST transitions; 2026 is a 53-week ISO year.
    for (const d of [new Date(2026, 2, 8, 12), new Date(2026, 10, 1, 1, 30), new Date(2026, 11, 31), new Date(2027, 0, 1), new Date(2027, 0, 4)]) {
      const s = payPeriodStart(d);
      expect(s.getDay()).toBe(1);
      expect([s.getHours(), s.getMinutes()]).toEqual([0, 0]);
      expect(s.getTime()).toBeLessThanOrEqual(d.getTime());
      const days = Math.round((Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()) - Date.UTC(2026, 0, 5)) / 864e5);
      expect(days % 14 === 0).toBe(true);
    }
    expect(ymd(payPeriodStart(new Date(2026, 2, 8, 12)))).toBe('2026-03-02');
    expect(ymd(payPeriodStart(new Date(2026, 10, 1, 1, 30)))).toBe('2026-10-26');
    expect(ymd(payPeriodStart(new Date(2027, 0, 1)))).toBe('2026-12-21');
    expect(ymd(payPeriodStart(new Date(2027, 0, 4)))).toBe('2027-01-04');
  });
});

describe('groupPayPeriods', () => {
  it('splits hours into week 1 / week 2 and ignores cancelled sessions', () => {
    const pps = groupPayPeriods([
      session('a', new Date(2026, 0, 5, 8), 8),
      session('b', new Date(2026, 0, 11, 8), 4),   // Sunday of week 1
      session('c', new Date(2026, 0, 12, 8), 8.5), // Monday of week 2
      session('x', new Date(2026, 0, 13, 8), 8, 'cancelled'),
    ]);
    expect(pps).toHaveLength(1);
    expect(pps[0]).toMatchObject({ key: '2026-01-05', week1Hours: 12, week2Hours: 8.5, totalHours: 20.5, sessionCount: 3 });
    expect(ymd(pps[0].end)).toBe('2026-01-19');
  });
  it('returns periods oldest first, one per 14-day block', () => {
    const pps = groupPayPeriods([session('late', new Date(2026, 1, 3, 8), 8), session('early', new Date(2026, 0, 6, 8), 8)]);
    expect(pps.map((p) => p.key)).toEqual(['2026-01-05', '2026-02-02']);
  });
  it('adds holiday pay to the right week without counting it as a session', () => {
    const pps = groupPayPeriods(
      [session('a', new Date(2026, 10, 23, 8), 8.5)],
      [{ date: new Date(2026, 10, 26), hours: 8.5 }, { date: new Date(2026, 10, 27), hours: 8.5 }] // Thanksgiving + Friday
    );
    expect(pps).toHaveLength(1);
    expect(pps[0]).toMatchObject({ key: '2026-11-23', week1Hours: 25.5, week2Hours: 0, totalHours: 25.5, sessionCount: 1 });
  });
  it('a holiday alone still opens its pay period', () => {
    const pps = groupPayPeriods([], [{ date: new Date(2026, 11, 25), hours: 8.5 }]);
    expect(pps.map((p) => [p.key, p.totalHours, p.sessionCount])).toEqual([['2026-12-21', 8.5, 0]]);
  });
  it('treats a missing hours value as zero', () => {
    const s = session('a', new Date(2026, 0, 5, 8), 0);
    delete (s as unknown as { hours?: number }).hours;
    expect(groupPayPeriods([s])[0].totalHours).toBe(0);
  });
});

describe('q', () => {
  it('rounds to the nearest quarter hour', () => {
    expect([q(1.1), q(1.13), q(84.99), q(0)]).toEqual([1, 1.25, 85, 0]);
  });
});
