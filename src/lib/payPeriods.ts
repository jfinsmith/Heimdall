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

/**
 * Pay periods are continuous 14-day blocks anchored to a known pay-period start.
 * The anchor is Monday of ISO week 2, 2026 (Jan 5) — "weeks 2–3 are the first
 * pay period of the year." Using a fixed anchor + 14-day arithmetic (instead of
 * ISO even/odd weeks) keeps periods exactly 14 days apart and never misaligns
 * across a 53-week ISO year (which previously created an overlapping period at
 * the year boundary).
 */
const PP_ANCHOR = new Date(2026, 0, 5); // Mon, Jan 5 2026
/** UTC midnight day-number — DST-safe integer day count. */
function dayNum(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
const ANCHOR_DAY = dayNum(PP_ANCHOR);

/** Monday that begins the 14-day pay period containing `d`. */
export function payPeriodStart(d: Date): Date {
  const idx = Math.floor((dayNum(d) - ANCHOR_DAY) / 14);
  const start = new Date(PP_ANCHOR);
  start.setDate(start.getDate() + idx * 14);
  start.setHours(0, 0, 0, 0);
  return start;
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
