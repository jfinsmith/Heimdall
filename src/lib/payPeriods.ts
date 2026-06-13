/**
 * Pay-period math for the Pasco Sheriff's Office cadence.
 *
 * Pay periods are bi-weekly and fixed to the calendar (ISO weeks), NOT to the
 * academy start: an EVEN ISO week is the first week of a pay period and the
 * following ODD week is the second — so weeks 2–3 of the year form the first
 * pay period, weeks 4–5 the second, etc.
 *
 * Sworn members must put 85 hours on each bi-weekly check; everything over is
 * overtime. ALL scheduled time-on-the-clock counts toward the 85 (FDLE
 * courses, PT, formation, PSO assignments) — lunch is already excluded from
 * each session's `hours`. PSO assignments are typically used to top a short
 * pay period up to 85.
 */
import type { Timestamp } from 'firebase/firestore';
import type { SessionDoc } from '../types';
import type { WithId } from './firestore';

export const DEFAULT_PAY_PERIOD_TARGET = 85;

/** ISO-8601 week number + week-year for a local date. */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdn = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdn + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return { year: date.getUTCFullYear(), week };
}

/** Monday (local, 00:00) of the date's week. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday that begins the pay period containing `d` (the even-week Monday). */
export function payPeriodStart(d: Date): Date {
  const { week } = isoWeek(d);
  const mon = mondayOf(d);
  if (week % 2 === 0) return mon;
  const prev = new Date(mon);
  prev.setDate(prev.getDate() - 7);
  return prev;
}

export interface PayPeriod {
  /** yyyy-mm-dd of the pay period's first Monday — stable key. */
  key: string;
  start: Date;
  /** Exclusive end (start + 14 days). */
  end: Date;
  week1Hours: number;
  week2Hours: number;
  totalHours: number;
  sessionCount: number;
}

/**
 * Group sessions into pay periods, summing every session's instructional hours
 * (all non-cancelled sessions — paid time, FDLE or agency alike). `extraBlocks`
 * adds hours on specific dates that aren't sessions — e.g. PSO-observed-holiday
 * pay (8.5 hrs) on a paid day off.
 */
export function groupPayPeriods(
  sessions: WithId<SessionDoc>[],
  extraBlocks: { date: Date; hours: number }[] = []
): PayPeriod[] {
  const map = new Map<string, PayPeriod>();
  const ensure = (d: Date) => {
    const ppStart = payPeriodStart(d);
    const key = `${ppStart.getFullYear()}-${String(ppStart.getMonth() + 1).padStart(2, '0')}-${String(ppStart.getDate()).padStart(2, '0')}`;
    let pp = map.get(key);
    if (!pp) {
      const end = new Date(ppStart);
      end.setDate(end.getDate() + 14);
      pp = { key, start: ppStart, end, week1Hours: 0, week2Hours: 0, totalHours: 0, sessionCount: 0 };
      map.set(key, pp);
    }
    return pp;
  };
  const addToWeek = (pp: PayPeriod, d: Date, hrs: number) => {
    const midpoint = new Date(pp.start);
    midpoint.setDate(midpoint.getDate() + 7);
    if (d < midpoint) pp.week1Hours += hrs;
    else pp.week2Hours += hrs;
    pp.totalHours += hrs;
  };

  for (const s of sessions) {
    if (s.status === 'cancelled') continue;
    const start = (s.start as Timestamp).toDate();
    const pp = ensure(start);
    addToWeek(pp, start, s.hours || 0);
    pp.sessionCount += 1;
  }
  for (const b of extraBlocks) {
    addToWeek(ensure(b.date), b.date, b.hours);
  }
  return [...map.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Round to the nearest quarter hour for clean display. */
export function q(n: number): number {
  return Math.round(n * 4) / 4;
}
