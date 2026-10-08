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
    dates: (y) => {
      const d = nthWeekday(y, 10, 4, 4);
      d.setDate(d.getDate() + 1); // calendar-day step, never a ms shift
      return [d];
    },
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
  /** True when the date was shifted off a weekend (name carries "(observed)"). */
  shifted?: boolean;
}

/**
 * Fixed-DATE holidays follow the federal observance rule: falling on a
 * Saturday → observed the Friday before; on a Sunday → observed the Monday
 * after (July 4 2027 is a Sunday → observed Mon July 5). Weekday-anchored
 * holidays (MLK, Memorial, Labor, Thanksgiving…) never land on weekends, and
 * winter break is built from weekdays.
 */
const OBSERVANCE_SHIFTED = new Set([
  'new_years',
  'juneteenth',
  'independence',
  'veterans',
  'christmas_eve',
  'christmas',
  'new_years_eve',
]);

/**
 * One year's holidays with weekend observance applied. When the observed slot
 * is already another holiday's day, step one more weekday in the same
 * direction (Christmas on a Saturday → Friday collides with Christmas Eve →
 * observed Thursday). Resolved against the FULL definition list, so the
 * outcome never depends on which subset a caller later filters to; winter
 * break stays out of the collision set (a school-only wash may legitimately
 * share a date with an observed PSO holiday).
 */
function resolveYear(year: number): Holiday[] {
  const taken = new Set<string>();
  const out: Holiday[] = [];
  for (const def of HOLIDAY_DEFS) {
    if (OBSERVANCE_SHIFTED.has(def.key)) continue;
    for (const date of def.dates(year)) {
      if (def.key !== 'winter_break') taken.add(date.toDateString());
      out.push({ date, name: def.label, key: def.key, shifted: false });
    }
  }
  // Cross-boundary + sibling seeds, so no two holidays ever observe the same
  // day (a shared day would double the pay credit):
  //  - next year's New Year's Day blocks NYE's forward shift (NYE on a Sunday
  //    observes Tue Jan 2, not on New Year's Day itself);
  //  - LAST year's New Year's Eve blocks THIS New Year's Day's backward shift
  //    (NYD on a Saturday observes Thu Dec 30, Dec 31 being NYE);
  //  - every fixed-date holiday that falls on a weekday will keep its literal
  //    date, so claim those up front — otherwise Christmas Eve on a Sunday
  //    would shift forward onto Christmas Day itself (it now observes Tue
  //    Dec 26 instead).
  taken.add(new Date(year + 1, 0, 1).toDateString());
  taken.add(new Date(year - 1, 11, 31).toDateString());
  for (const def of HOLIDAY_DEFS) {
    if (!OBSERVANCE_SHIFTED.has(def.key)) continue;
    for (const actual of def.dates(year)) {
      if (actual.getDay() !== 0 && actual.getDay() !== 6) taken.add(actual.toDateString());
    }
  }
  for (const def of HOLIDAY_DEFS) {
    if (!OBSERVANCE_SHIFTED.has(def.key)) continue;
    for (const actual of def.dates(year)) {
      const day = actual.getDay();
      let date = actual;
      let shifted = false;
      if (day === 6 || day === 0) {
        const dir = day === 6 ? -1 : 1;
        date = new Date(actual);
        do {
          date.setDate(date.getDate() + dir);
        } while (date.getDay() === 0 || date.getDay() === 6 || taken.has(date.toDateString()));
        shifted = true;
      }
      taken.add(date.toDateString());
      out.push({ date, name: shifted ? `${def.label} (observed)` : def.label, key: def.key, shifted });
    }
  }
  return out;
}

/** All enabled holidays for a year, observance applied (disabled keys excluded). */
export function holidaysForYear(year: number, disabled: Set<string> = new Set()): Holiday[] {
  return resolveYear(year).filter((h) => !disabled.has(h.key));
}

/** Hours of holiday pay a PSO-observed holiday grants toward the pay period. */
export const HOLIDAY_PAY_HOURS = 8.5;

/** Observed-holiday dates within [start, end) (inclusive of start day),
 *  OBSERVANCE-SHIFTED — a Sunday July 4 credits its pay on Monday July 5, in
 *  Monday's pay period, matching when people actually get the day off. The
 *  year loop starts one year early because a shifted New Year's Eve can land
 *  on Jan 2 of the following year (and one year late: next year's New Year's
 *  Day can observe on Dec 30 of this one). */
export function observedHolidayDatesInRange(start: Date, end: Date, observed: Set<string>): Date[] {
  const out: Date[] = [];
  if (observed.size === 0) return out;
  for (let y = start.getFullYear() - 1; y <= end.getFullYear() + 1; y++) {
    for (const h of resolveYear(y)) {
      if (!observed.has(h.key)) continue;
      if (h.date >= start && h.date < end) out.push(h.date);
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
  range?: { fromYear: number; toYear: number },
  // labelInBody: for calendars that HIDE the all-day lane (the builder), draw a
  // timed wash over the work hours (08:00–16:30) that carries the holiday name in
  // the grid body — otherwise the name (an all-day event) would be invisible.
  opts: { labelInBody?: boolean } = {}
): EventInput[] {
  // Holidays are computed, not hardcoded, so any year is derivable. Render the
  // span the calendar actually shows (data-driven) — clamped to at least
  // [last year … two years out] so an empty/near-term calendar still shades.
  const now = new Date().getFullYear();
  const fromYear = Math.min(range?.fromYear ?? now - 1, now - 1);
  const toYear = Math.max(range?.toYear ?? now + 2, now + 2);
  const events: EventInput[] = [];
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of holidaysForYear(y, disabled)) {
      // Local-date key (toISOString would shift a local-midnight date a day in +UTC zones).
      const key = dateKey(h.date);
      const isObserved = observed.has(h.key);
      if (opts.labelInBody) {
        // Timed wash over the work hours, carrying the name in the grid body.
        const ws = new Date(h.date.getFullYear(), h.date.getMonth(), h.date.getDate(), 8, 0);
        const we = new Date(h.date.getFullYear(), h.date.getMonth(), h.date.getDate(), 16, 30);
        events.push({
          id: `holiday-body-${key}`,
          title: h.name,
          start: ws,
          end: we,
          display: 'background',
          backgroundColor: isObserved ? '#bbf7d0' : '#fecaca',
          extendedProps: { holiday: true, holidayBodyLabel: true, observedPay: isObserved ? HOLIDAY_PAY_HOURS : 0 },
        });
      } else {
        events.push({
          id: `holiday-bg-${key}`,
          start: h.date,
          allDay: true,
          display: 'background',
          backgroundColor: '#b91c1c',
          extendedProps: { holiday: true },
        });
      }
      // All-day name label — month banner + list view (+ the all-day lane on
      // calendars that show it). Hidden in the builder's time-grid (no lane), where
      // the timed wash above carries the name instead.
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
