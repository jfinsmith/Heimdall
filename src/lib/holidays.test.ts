/** Federal weekend-observance + year-edge collision rules for the school calendar. */
import { describe, it, expect } from 'vitest';
import { HOLIDAY_DEFS, holidaysForYear, observedHolidayDatesInRange } from './holidays';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** key → observed yyyy-mm-dd for one year (winter break excluded — it is multi-day). */
const byKey = (year: number) =>
  Object.fromEntries(holidaysForYear(year).filter((h) => h.key !== 'winter_break').map((h) => [h.key, ymd(h.date)]));
const ALL = new Set(HOLIDAY_DEFS.map((d) => d.key));

describe('holidaysForYear — weekday-anchored holidays', () => {
  it('computes the 2026 floating holidays', () => {
    expect(byKey(2026)).toMatchObject({
      mlk: '2026-01-19',
      presidents: '2026-02-16',
      memorial: '2026-05-25',
      labor: '2026-09-07',
      thanksgiving: '2026-11-26',
      day_after_thanksgiving: '2026-11-27',
    });
  });
  it('Memorial Day is the LAST Monday even when May has five (2027: May 31)', () => {
    expect(byKey(2027).memorial).toBe('2027-05-31');
  });
});

describe('holidaysForYear — fixed-date observance (Sat → Fri, Sun → Mon)', () => {
  it('a weekday holiday keeps its date and is not marked shifted', () => {
    const h = holidaysForYear(2026).find((x) => x.key === 'veterans')!;
    expect(ymd(h.date)).toBe('2026-11-11');
    expect(h.shifted).toBe(false);
    expect(h.name).toBe('Veterans Day');
  });
  it('Saturday → the Friday before (July 4 2026, Juneteenth 2027)', () => {
    const h = holidaysForYear(2026).find((x) => x.key === 'independence')!;
    expect(ymd(h.date)).toBe('2026-07-03');
    expect(h.shifted).toBe(true);
    expect(h.name).toBe('Independence Day (observed)');
    expect(byKey(2027).juneteenth).toBe('2027-06-18');
  });
  it('Sunday → the Monday after (July 4 2027, Juneteenth 2022)', () => {
    expect(byKey(2027).independence).toBe('2027-07-05');
    expect(byKey(2022).juneteenth).toBe('2022-06-20');
  });
});

describe('holidaysForYear — collisions around Christmas and the year edge', () => {
  it('Christmas on a Saturday steps past Christmas Eve to Thursday (2027)', () => {
    expect(byKey(2027)).toMatchObject({ christmas_eve: '2027-12-24', christmas: '2027-12-23', new_years_eve: '2027-12-31' });
  });
  it('New Year\'s Day on a Saturday observes Thu Dec 30 of the PRIOR year — Dec 31 is New Year\'s Eve (2028)', () => {
    expect(byKey(2028).new_years).toBe('2027-12-30');
  });
  it('Eve on Saturday + Day on Sunday split to Friday and Monday (2022 → Jan 2 2023)', () => {
    expect(byKey(2022)).toMatchObject({ christmas_eve: '2022-12-23', christmas: '2022-12-26', new_years_eve: '2022-12-30' });
    expect(byKey(2023).new_years).toBe('2023-01-02');
  });
  it('Eve on a Sunday steps past the holiday itself to Tuesday, across the year edge too (2023)', () => {
    expect(byKey(2023)).toMatchObject({ christmas: '2023-12-25', christmas_eve: '2023-12-26', new_years_eve: '2024-01-02' });
    expect(byKey(2024).new_years).toBe('2024-01-01');
  });
  it('no two paid holidays ever observe the same day, and none lands on a weekend (1990–2110)', () => {
    const seen = new Map<string, string>();
    for (let y = 1990; y <= 2110; y++) {
      for (const h of holidaysForYear(y)) {
        if (h.key === 'winter_break') continue;
        const day = ymd(h.date);
        expect(seen.get(day), `${day}: ${h.key}@${y} vs ${seen.get(day)}`).toBeUndefined();
        seen.set(day, `${h.key}@${y}`);
        expect([0, 6]).not.toContain(h.date.getDay());
      }
    }
  });
});

describe('holidaysForYear — winter break + disabled keys', () => {
  it('is the weekdays of the Christmas and New Year\'s weeks minus the four paid holidays (2026)', () => {
    const wb = holidaysForYear(2026).filter((h) => h.key === 'winter_break').map((h) => ymd(h.date));
    expect(wb).toEqual(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-28', '2026-12-29', '2026-12-30']);
  });
  it('drops disabled keys without disturbing how the others resolve', () => {
    const hs = holidaysForYear(2027, new Set(['christmas_eve', 'juneteenth']));
    expect(hs.some((h) => h.key === 'christmas_eve' || h.key === 'juneteenth')).toBe(false);
    // Christmas still observes Thursday: the outcome never depends on the filter.
    expect(ymd(hs.find((h) => h.key === 'christmas')!.date)).toBe('2027-12-23');
  });
});

describe('observedHolidayDatesInRange — holiday pay credit', () => {
  it('returns nothing when no holiday is observed', () => {
    expect(observedHolidayDatesInRange(new Date(2026, 0, 1), new Date(2027, 0, 1), new Set())).toEqual([]);
  });
  it('credits the OBSERVED day, start-inclusive and end-exclusive', () => {
    const keys = new Set(['independence']);
    // July 4 2027 is a Sunday → the credit belongs to Monday July 5.
    expect(observedHolidayDatesInRange(new Date(2027, 6, 5), new Date(2027, 6, 6), keys).map(ymd)).toEqual(['2027-07-05']);
    expect(observedHolidayDatesInRange(new Date(2027, 6, 4), new Date(2027, 6, 5), keys)).toEqual([]);
  });
  it('finds a holiday observed in the NEIGHBOURING year (NYE 2023 → Jan 2 2024; NYD 2028 → Dec 30 2027)', () => {
    expect(observedHolidayDatesInRange(new Date(2024, 0, 1), new Date(2024, 0, 8), new Set(['new_years_eve'])).map(ymd)).toEqual(['2024-01-02']);
    expect(observedHolidayDatesInRange(new Date(2027, 11, 27), new Date(2028, 0, 1), new Set(['new_years'])).map(ymd)).toEqual(['2027-12-30']);
  });
  it('credits a day once even when winter break and an observed holiday share it', () => {
    const days = observedHolidayDatesInRange(new Date(2027, 11, 20), new Date(2028, 0, 3), ALL).map(ymd).sort();
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2027-12-23'); // Christmas (observed) AND a winter-break weekday
  });
});
