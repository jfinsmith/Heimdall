/** Unit tests for the calendar→attendance-roster grouping (the day-roster crux). */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { WithId } from '../../../lib/firestore';
import type { SessionDoc } from '../../../types';
import { buildDayRosters } from './attendanceRoster';

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
