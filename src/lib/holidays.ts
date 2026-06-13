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
  {
    key: 'winter_break',
    label: 'Winter Break (Dec 22–31)',
    dates: (y) => Array.from({ length: 10 }, (_, i) => new Date(y, 11, 22 + i)),
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

/**
 * FullCalendar events: a red background wash per holiday day plus a bold-black
 * label chip (FC renders an empty event when eventContent returns undefined,
 * so the label is drawn explicitly in renderEventContent).
 */
export function holidayBackgroundEvents(disabled: Set<string> = new Set(), yearsAhead = 2): EventInput[] {
  const now = new Date().getFullYear();
  const events: EventInput[] = [];
  for (let y = now - 1; y <= now + yearsAhead; y++) {
    for (const h of holidaysForYear(y, disabled)) {
      const key = h.date.toISOString().slice(0, 10);
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
        backgroundColor: '#fecaca',
        borderColor: '#fca5a5',
        textColor: '#000000',
        editable: false,
        classNames: ['hd-holiday'],
        extendedProps: { holiday: true },
      });
    }
  }
  return events;
}
