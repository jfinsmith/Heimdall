/** Unit tests for the calendar→attendance-roster grouping (the day-roster crux). */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { WithId } from '../../../lib/firestore';
import type { SessionDoc } from '../../../types';
import { buildClassDays, buildDayRosters, classDateRange, examCoursesOnDay, isTestSession, nextSessionDate } from './attendanceRoster';

const ts = (h: number, m = 0) => Timestamp.fromDate(new Date(2026, 5, 1, h, m, 0)); // 2026-06-01 local

function sess(over: Partial<SessionDoc> & { id: string }): WithId<SessionDoc> {
  return {
    academyId: 'a1', courseId: 'c', courseName: 'X', highLiability: false,
    start: ts(8), end: ts(9), location: '', room: '', hours: 1, status: 'scheduled',
    roleSlots: [], createdBy: 'u', updatedAt: ts(8),
    ...over,
  } as WithId<SessionDoc>;
}

const DAY = '2026-06-01';

describe('buildDayRosters', () => {
  it('one roster per course; merges a course across the lunch with whole-day span', () => {
    const sessions = [
      sess({ id: 'pt', courseName: 'Physical Fitness', start: ts(7), end: ts(8), hours: 1 }),
      sess({ id: 'i1', courseName: 'Intro to LE', start: ts(8), end: ts(12), hours: 4 }),
      sess({ id: 'lunch', kind: 'lunch', courseName: 'Lunch', start: ts(12), end: ts(12, 30), hours: 0 }),
      sess({ id: 'i2', courseName: 'Intro to LE', start: ts(12, 30), end: ts(17), hours: 4.5 }),
    ];
    const rosters = buildDayRosters(sessions, DAY, new Set(['Physical Fitness', 'Intro to LE']));
    expect(rosters.map((r) => r.courseName)).toEqual(['Physical Fitness', 'Intro to LE']);
    const intro = rosters[1];
    expect(intro.classHours).toBe(8.5); // 4 + 4.5
    expect(intro.timeLabel).toBe('0800 - 1700'); // whole-day span, not the blocks
    expect(intro.lunch).toBe('1200 - 1230');
  });

  it('a different course between two runs of the same course splits them', () => {
    const sessions = [
      sess({ id: 'i1', courseName: 'Intro to LE', start: ts(8), end: ts(10), hours: 2 }),
      sess({ id: 'pt', courseName: 'PT', start: ts(10), end: ts(11), hours: 1 }),
      sess({ id: 'i2', courseName: 'Intro to LE', start: ts(11), end: ts(13), hours: 2 }),
    ];
    expect(buildDayRosters(sessions, DAY, new Set(['Intro to LE', 'PT'])).map((r) => r.courseName)).toEqual(['Intro to LE', 'PT', 'Intro to LE']);
  });

  it('pulls lead + additional instructors, excludes role players, no duplicates', () => {
    const sessions = [
      sess({ id: 'i1', courseName: 'Intro', start: ts(8), end: ts(12), hours: 4, roleSlots: [
        { slotId: 's1', role: 'lead', count: 1, filledBy: ['lead1'] },
        { slotId: 's2', role: 'assistant', count: 1, filledBy: ['asst1'] },
        { slotId: 's3', role: 'role_player', count: 1, filledBy: ['rp1'] },
      ] }),
      sess({ id: 'i2', courseName: 'Intro', start: ts(13), end: ts(17), hours: 4, roleSlots: [
        { slotId: 's4', role: 'lead', count: 1, filledBy: ['lead1'] },
        { slotId: 's5', role: 'safety_officer', count: 1, filledBy: ['lead1'] },
      ] }),
    ];
    const [r] = buildDayRosters(sessions, DAY, new Set(['Intro']));
    expect(r.leadUids).toEqual(['lead1']);
    expect(r.additionalUids).toEqual(['asst1']); // lead1 not double-listed; rp1 excluded
  });

  it('as-taught write-ins print with the signed-up instructors (lead vs additional)', () => {
    const sessions = [
      sess({
        id: 'i1', courseName: 'Intro', start: ts(9), end: ts(12), hours: 3,
        roleSlots: [{ slotId: 's1', role: 'lead', count: 1, filledBy: [] }],
        writeInInstructors: [
          { name: 'Sgt. Dana Cole (HCSO)', role: 'lead' },
          { name: 'B. Ortiz', role: 'assistant' },
          { name: 'R. Player', role: 'role_player' }, // not a roster instructor
        ],
      }),
    ];
    const [r] = buildDayRosters(sessions, DAY, new Set(['Intro']));
    expect(r.leadUids).toEqual([]);
    expect(r.writeInLeads).toEqual(['Sgt. Dana Cole (HCSO)']);
    expect(r.writeInAdditional).toEqual(['B. Ortiz']); // role player excluded
  });

  it('cancelled blocks never print a roster, pad hours, split a run, or list instructors', () => {
    const sessions = [
      sess({ id: 'i1', courseName: 'Intro', start: ts(8), end: ts(10), hours: 2 }),
      // A cancelled block of ANOTHER course in the middle must not split Intro in two…
      sess({ id: 'x', courseName: 'Legal', start: ts(10), end: ts(11), hours: 1, status: 'cancelled' }),
      sess({ id: 'i2', courseName: 'Intro', start: ts(11), end: ts(13), hours: 2 }),
      // …and a cancelled late block of the SAME course must not stretch the span/hours.
      sess({ id: 'i3', courseName: 'Intro', start: ts(15), end: ts(19), hours: 4, status: 'cancelled', roleSlots: [
        { slotId: 's1', role: 'lead', count: 1, filledBy: ['ghost'] },
      ] }),
    ];
    const rosters = buildDayRosters(sessions, DAY, new Set(['Intro', 'Legal']));
    expect(rosters.map((r) => r.courseName)).toEqual(['Intro']);
    expect(rosters[0].classHours).toBe(4);
    expect(rosters[0].timeLabel).toBe('0800 - 1300');
    expect(rosters[0].leadUids).toEqual([]);
    // A day whose only block was cancelled prints nothing.
    expect(buildDayRosters([sessions[1]], DAY, new Set(['Legal']))).toEqual([]);
  });

  it('rosters ONLY official curriculum courses — custom/agency blocks excluded', () => {
    const sessions = [
      sess({ id: 'pso', courseName: 'PSO Assignment', countsTowardFdle: false, start: ts(8), end: ts(9), hours: 1 }),
      sess({ id: 'guest', courseName: 'Guest Speaker', start: ts(9), end: ts(10), hours: 1 }),
      sess({ id: 'i1', courseName: 'Intro', start: ts(10), end: ts(12), hours: 2 }),
    ];
    // Only 'Intro' is in the curriculum → the PSO + custom guest block are dropped.
    expect(buildDayRosters(sessions, DAY, new Set(['Intro'])).map((r) => r.courseName)).toEqual(['Intro']);
  });
});

describe('exam-day helpers', () => {
  it('a 1-hr test followed by 9 hrs of another course = two rosters, one test course', () => {
    const sessions = [
      sess({ id: 't', courseName: 'Defensive Tactics', start: ts(7), end: ts(8), hours: 1, includesTest: true }),
      sess({ id: 'v1', courseName: 'Vehicle Operations', start: ts(8), end: ts(12), hours: 4 }),
      sess({ id: 'lunch', kind: 'lunch', courseName: 'Lunch', start: ts(12), end: ts(13), hours: 0 }),
      sess({ id: 'v2', courseName: 'Vehicle Operations', start: ts(13), end: ts(18), hours: 5 }),
    ];
    const rosters = buildDayRosters(sessions, DAY, new Set(['Defensive Tactics', 'Vehicle Operations']));
    expect(rosters.map((r) => [r.courseName, r.classHours])).toEqual([['Defensive Tactics', 1], ['Vehicle Operations', 9]]);
    expect(examCoursesOnDay(sessions, DAY)).toEqual(['Defensive Tactics']);
  });

  it('detects tests by checkbox or the legacy "Test" note; ignores cancelled + lunch + other days', () => {
    expect(isTestSession({ includesTest: true, notes: '' })).toBe(true);
    expect(isTestSession({ includesTest: false, notes: 'Unit TEST — bring pencils' })).toBe(true);
    expect(isTestSession({ includesTest: false, notes: 'Contest prep; latest scores' })).toBe(false);
    const sessions = [
      sess({ id: 'a', courseName: 'Legal', notes: 'Test', status: 'cancelled' }),
      sess({ id: 'b', courseName: 'Legal', notes: 'test', start: Timestamp.fromDate(new Date(2026, 5, 2, 8)), end: Timestamp.fromDate(new Date(2026, 5, 2, 9)) }),
      sess({ id: 'c', courseName: 'Communication', includesTest: true, start: ts(9), end: ts(10) }),
      sess({ id: 'd', courseName: 'Communication', notes: 'test', start: ts(8), end: ts(9) }),
    ];
    expect(examCoursesOnDay(sessions, DAY)).toEqual(['Communication']); // deduped, cancelled + next-day excluded
  });

  it('nextSessionDate skips empty days (weekends/holidays) and cancelled or lunch-only days', () => {
    const at = (d: number, over: Partial<SessionDoc> = {}) =>
      sess({ id: `s${d}${over.status ?? ''}${over.kind ?? ''}`, start: Timestamp.fromDate(new Date(2026, 5, d, 8)), end: Timestamp.fromDate(new Date(2026, 5, d, 9)), ...over });
    const sessions = [at(5), at(6, { status: 'cancelled' }), at(7, { kind: 'lunch' }), at(8), at(9)];
    expect(nextSessionDate(sessions, '2026-06-05')).toBe('2026-06-08'); // Fri → Mon, skipping the cancelled Sat + lunch-only Sun
    expect(nextSessionDate(sessions, '2026-06-08')).toBe('2026-06-09');
    expect(nextSessionDate(sessions, '2026-06-09')).toBeNull();
  });
});

describe('buildClassDays — the whole-class packet', () => {
  const at = (day: number, h: number, m = 0) => Timestamp.fromDate(new Date(2026, 5, day, h, m, 0));
  const sessions = [
    sess({ id: 'd2', courseName: 'Traffic Stops', start: at(2, 8), end: at(2, 12), hours: 4 }),
    sess({ id: 'a', courseName: 'Orientation', start: at(1, 8), end: at(1, 10), hours: 2 }),
    sess({ id: 'b', courseName: 'FOP', start: at(1, 10), end: at(1, 12), hours: 2.1 }),
    sess({ id: 'lunch', kind: 'lunch', courseName: 'Lunch', start: at(1, 12), end: at(1, 13), hours: 0 }),
    sess({ id: 'c', courseName: 'Orientation', start: at(1, 13), end: at(1, 17), hours: 4.2 }),
    sess({ id: 'gone', courseName: 'Cancelled topic', start: at(3, 8), end: at(3, 12), hours: 4, status: 'cancelled' }),
    sess({ id: 'onlyLunch', kind: 'lunch', courseName: 'Lunch', start: at(4, 12), end: at(4, 13), hours: 0 }),
  ];

  it('makes one entry per day, in date order, with every topic and its hours', () => {
    const days = buildClassDays(sessions, '2026-06-01', '2026-06-30', null);
    expect(days.map((d) => d.dateStr)).toEqual(['2026-06-01', '2026-06-02']); // nothing for cancelled / lunch-only days
    expect(days[0].topics.map((t) => [t.courseName, t.classHours])).toEqual([['Orientation', 2], ['FOP', 2.1], ['Orientation', 4.2]]);
    expect(days[0]).toMatchObject({ timeLabel: '0800 - 1700', totalHours: 8.3, lunch: '1200 - 1300' });
  });
  it('can leave out blocks that are not in the curriculum, dropping days left empty', () => {
    const days = buildClassDays(sessions, '2026-06-01', '2026-06-30', new Set(['Orientation']));
    expect(days.map((d) => d.dateStr)).toEqual(['2026-06-01']);
    expect(days[0].topics.map((t) => t.courseName)).toEqual(['Orientation']);
  });
  it('honors the date range, both ends included', () => {
    expect(buildClassDays(sessions, '2026-06-02', '2026-06-02', null).map((d) => d.dateStr)).toEqual(['2026-06-02']);
  });
  it('the default range spans live blocks only', () => {
    expect(classDateRange(sessions)).toEqual({ from: '2026-06-01', to: '2026-06-02' });
    expect(classDateRange([])).toBeNull();
  });
});
