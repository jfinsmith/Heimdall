/**
 * School-calendar holidays — shown as background shading on CADRE calendars so
 * coordinators avoid scheduling on days the host college is closed. Each
 * holiday has a stable key so admins can toggle individual ones on/off
 * (Admin → Holidays); e.g. the college may not close for Juneteenth.
 */
import type { EventInput } from '@fullcalendar/core';

/** Stable holiday definitions (key + label + date computation). */
export interface HolidayDef {
  key: string;
  label: string;
  /** Dates this holiday occupies in a given year (winter break spans many). */
  dates: (year: number) => Date[];
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month + 1, 0 - offset);
}
/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const HOLIDAY_DEFS: HolidayDef[] = [
  { key: 'new_years', label: 'New Year’s Day', dates: (y) => [new Date(y, 0, 1)] },
  { key: 'mlk', label: 'MLK Jr. Day', dates: (y) => [nthWeekday(y, 0, 1, 3)] },
  { key: 'presidents', label: 'Presidents’ Day', dates: (y) => [nthWeekday(y, 1, 1, 3)] },
  { key: 'memorial', label: 'Memorial Day', dates: (y) => [lastWeekday(y, 4, 1)] },
  { key: 'juneteenth', label: 'Juneteenth', dates: (y) => [new Date(y, 5, 19)] },
  { key: 'independence', label: 'Independence Day', dates: (y) => [new Date(y, 6, 4)] },
  { key: 'labor', label: 'Labor Day', dates: (y) => [nthWeekday(y, 8, 1, 1)] },
  { key: 'veterans', label: 'Veterans Day', dates: (y) => [new Date(y, 10, 11)] },
  { key: 'thanksgiving', label: 'Thanksgiving', dates: (y) => [nthWeekday(y, 10, 4, 4)] },
  {
    key: 'day_after_thanksgiving',
    label: 'Day after Thanksgiving',
    dates: (y) => [new Date(nthWeekday(y, 10, 4, 4).getTime() + 864e5)],
  },
  // The four PSO paid holidays around the break — each can be observed
  // (paid) independently of the school winter break.
  { key: 'christmas_eve', label: 'Christmas Eve', dates: (y) => [new Date(y, 11, 24)] },
  { key: 'christmas', label: 'Christmas Day', dates: (y) => [new Date(y, 11, 25)] },
  { key: 'new_years_eve', label: 'New Year’s Eve', dates: (y) => [new Date(y, 11, 31)] },
  {
    // School winter break: Monday–Friday of week 52 (the week of Christmas) and
    // week 1 (the week of New Year's Day), MINUS the four PSO paid holidays
    // above. School-only — not a PSO paid holiday.
    key: 'winter_break',
    label: 'Winter Break (school only)',
    dates: (y) => {
      const excluded = new Set(
        [new Date(y, 11, 24), new Date(y, 11, 25), new Date(y, 11, 31), new Date(y + 1, 0, 1)].map((d) =>
          d.toDateString()
        )
      );
      const out: Date[] = [];
      const seen = new Set<string>();
      // Weekdays of the Christmas week and the New Year's week.
      for (const anchor of [new Date(y, 11, 25), new Date(y + 1, 0, 1)]) {
        const mon = mondayOf(anchor);
        for (let i = 0; i < 5; i++) {
          const d = new Date(mon);
          d.setDate(d.getDate() + i);
          const k = d.toDateString();
          if (excluded.has(k) || seen.has(k)) continue;
          seen.add(k);
          out.push(d);
        }
      }
      return out;
    },
  },
];

export interface Holiday {
  date: Date;
  name: string;
  key: string;
}

/** All enabled holidays for a year (disabled keys excluded). */
export function holidaysForYear(year: number, disabled: Set<string> = new Set()): Holiday[] {
  const out: Holiday[] = [];
  for (const def of HOLIDAY_DEFS) {
    if (disabled.has(def.key)) continue;
    for (const date of def.dates(year)) out.push({ date, name: def.label, key: def.key });
  }
  return out;
}

/** Hours of holiday pay a PSO-observed holiday grants toward the pay period. */
export const HOLIDAY_PAY_HOURS = 8.5;

/** Observed-holiday dates within [start, end) (inclusive of start day). */
export function observedHolidayDatesInRange(start: Date, end: Date, observed: Set<string>): Date[] {
  const out: Date[] = [];
  if (observed.size === 0) return out;
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    for (const def of HOLIDAY_DEFS) {
      if (!observed.has(def.key)) continue;
      for (const date of def.dates(y)) {
        if (date >= start && date < end) out.push(date);
      }
    }
  }
  return out;
}

/**
 * FullCalendar events: a red background wash per holiday day plus a bold-black
 * label chip (FC renders an empty event when eventContent returns undefined,
 * so the label is drawn explicitly in renderEventContent).
 */
export function holidayBackgroundEvents(
  disabled: Set<string> = new Set(),
  observed: Set<string> = new Set(),
  yearsAhead = 2
): EventInput[] {
  const now = new Date().getFullYear();
  const events: EventInput[] = [];
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let y = now - 1; y <= now + yearsAhead; y++) {
    for (const h of holidaysForYear(y, disabled)) {
      // Local-date key (toISOString would shift a local-midnight date a day in +UTC zones).
      const key = dateKey(h.date);
      const isObserved = observed.has(h.key);
      events.push({
        id: `holiday-bg-${key}`,
        start: h.date,
        allDay: true,
        display: 'background',
        backgroundColor: '#b91c1c',
        extendedProps: { holiday: true },
      });
      events.push({
        id: `holiday-label-${key}`,
        title: h.name,
        start: h.date,
        allDay: true,
        // Observed (paid) holidays get a green chip; others stay red.
        backgroundColor: isObserved ? '#bbf7d0' : '#fecaca',
        borderColor: isObserved ? '#86efac' : '#fca5a5',
        textColor: '#000000',
        editable: false,
        classNames: ['hd-holiday'],
        extendedProps: { holiday: true, observedPay: isObserved ? HOLIDAY_PAY_HOURS : 0 },
      });
    }
  }
  return events;
}
