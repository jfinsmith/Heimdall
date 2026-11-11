/**
 * Calendar-day helpers for the Viewer staffing page, pinned to the org's time
 * zone (America/New_York — see the org #2 punch list). The page's reader may
 * be an assistant whose browser runs in UTC, so every date and time it shows
 * is formatted HERE, never in the browser.
 */
export const VIEWER_TZ = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: VIEWER_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VIEWER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: VIEWER_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: VIEWER_TZ, weekday: 'short', month: 'short', day: 'numeric' });
const stampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: VIEWER_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'yyyy-mm-dd' when the string is a real calendar date, else null. */
export function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
}

/** The org-local calendar date of an instant, as 'yyyy-mm-dd'. */
export function localDate(ms: number): string {
  return ymdFmt.format(new Date(ms));
}
/** 'HH:mm' (24-hour) in the org's zone. */
export function localTime(ms: number): string {
  return hmFmt.format(new Date(ms));
}
/** e.g. 'Mon, Nov 16'. */
export function localDay(ms: number): string {
  return dayFmt.format(new Date(ms));
}
/** e.g. 'Nov 16, 2:05 PM EST' — for log lines. */
export function localStamp(ms: number): string {
  return stampFmt.format(new Date(ms));
}

/** 'yyyy-mm-dd' plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole calendar days from a to b ('yyyy-mm-dd'). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}

/** Offset (local minus UTC, ms) of the org's zone at an instant. */
function offsetAt(ms: number): number {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant of local midnight starting `date` in the org's zone (DST-safe). */
export function localMidnightMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let ms = guess - offsetAt(guess);
  const second = guess - offsetAt(ms);
  if (second !== ms) ms = second;
  return ms;
}
