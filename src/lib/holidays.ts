/**
 * School-calendar holidays — shown as background shading on CADRE calendars
 * so coordinators avoid scheduling courses on days the host college is closed.
 * Computed (no API): fixed dates + nth-weekday rules, plus typical school
 * breaks (winter break, day after Thanksgiving).
 */
import type { EventInput } from '@fullcalendar/core';

interface Holiday {
  date: Date;
  name: string;
}

/** nth (1-based) occurrence of a weekday (0=Sun) in a month (0-based). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

/** Last occurrence of a weekday in a month. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month + 1, 0 - offset);
}

export function holidaysForYear(year: number): Holiday[] {
  const list: Holiday[] = [
    { date: new Date(year, 0, 1), name: 'New Year’s Day' },
    { date: nthWeekday(year, 0, 1, 3), name: 'MLK Jr. Day' },
    { date: nthWeekday(year, 1, 1, 3), name: 'Presidents’ Day' },
    { date: lastWeekday(year, 4, 1), name: 'Memorial Day' },
    { date: new Date(year, 5, 19), name: 'Juneteenth' },
    { date: new Date(year, 6, 3), name: 'Independence Day (observed window)' },
    { date: new Date(year, 6, 4), name: 'Independence Day' },
    { date: nthWeekday(year, 8, 1, 1), name: 'Labor Day' },
    { date: new Date(year, 10, 11), name: 'Veterans Day' },
    { date: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving' },
    { date: new Date(nthWeekday(year, 10, 4, 4).getTime() + 864e5), name: 'Day after Thanksgiving' },
  ];
  // Winter break: Dec 22 – Dec 31 (typical college closure)
  for (let d = 22; d <= 31; d++) {
    list.push({ date: new Date(year, 11, d), name: 'Winter Break' });
  }
  return list;
}

/**
 * FullCalendar events covering `yearsAhead` years: a red background wash for
 * the day PLUS a readable all-day label chip (background-event titles render
 * too faintly to read on their own).
 */
export function holidayBackgroundEvents(yearsAhead = 2): EventInput[] {
  const now = new Date().getFullYear();
  const events: EventInput[] = [];
  for (let y = now - 1; y <= now + yearsAhead; y++) {
    for (const h of holidaysForYear(y)) {
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
