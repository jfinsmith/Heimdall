/** Small date/time helpers used across CADRE. */
import { Timestamp } from 'firebase/firestore';

export function fmtDate(ts: Timestamp | Date): string {
  const d = ts instanceof Date ? ts : ts.toDate();
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtTime(ts: Timestamp | Date): string {
  const d = ts instanceof Date ? ts : ts.toDate();
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtRange(start: Timestamp, end: Timestamp): string {
  return `${fmtDate(start)} ${fmtTime(start)}–${fmtTime(end)}`;
}

/** True if two [start,end) windows overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Hours between two timestamps, rounded to the nearest quarter hour. */
export function hoursBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 36e5) * 4) / 4;
}

/**
 * A scheduled block must have a positive duration — its end strictly after its
 * start. A zero/negative-duration session is bad data: FullCalendar renders it
 * with a null `end`, which historically crashed the calendar. Every create/edit
 * path that sets a session's times should gate on this before writing.
 */
export function isValidDuration(start: Date, end: Date): boolean {
  return end.getTime() > start.getTime();
}

/** Standard message shown when a session's end isn't after its start. */
export const END_BEFORE_START_MSG = 'The end time must be after the start time.';

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Combine a yyyy-mm-dd date string and HH:MM time string into a local Date. */
export function combineDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const tsFromDate = (d: Date) => Timestamp.fromDate(d);

/** FDLE instructor-cert expiration is always March 31 of the cert year (noon, TZ-safe). */
export const march31 = (year: number): Date => new Date(year, 2, 31, 12, 0, 0);
/** The cert year a March-31 expiration falls in. */
export const certYearOf = (ts: Timestamp): number => ts.toDate().getFullYear();
