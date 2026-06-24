/**
 * Build FDLE attendance rosters from the calendar: ONE roster per contiguous run
 * of the SAME course on a given day. A lunch placeholder block bridges a run (a
 * course's morning + afternoon become one roster spanning the lunch); a different
 * course breaks it. Class hours sum each block's stored instructional `hours`
 * (already honoring the per-block "lunch counts toward hours" flag), and the span
 * is the whole-day start→end across the run.
 */
import type { WithId } from '../../../lib/firestore';
import type { SessionDoc, SlotRole } from '../../../types';

/** Local yyyy-mm-dd of a Date (matches the calendar's local-day grouping). */
export function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Military HHMM for a Date (e.g. 0800, 1730). */
function mil(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}`;
}

/** "HH:MM" applied to the same calendar day as `ref`. */
function atTime(ref: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(ref);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export interface DayRoster {
  courseName: string;
  start: Date;
  end: Date;
  /** Whole-day clock span, e.g. "0800 - 1700". */
  timeLabel: string;
  /** Sum of the run's stored instructional hours (honors the lunch checkbox). */
  classHours: number;
  /** Lunch window inside the span, "HHMM - HHMM", or '' if none. */
  lunch: string;
  leadUids: string[];
  additionalUids: string[];
}

// Instructor roles that print on the "Additional Instructors" line (lead has its
// own line; role players and coordinators are not roster instructors).
const ADDITIONAL_INSTRUCTOR_ROLES: SlotRole[] = ['assistant', 'safety_officer'];

export function buildDayRosters(
  sessions: WithId<SessionDoc>[],
  dateStr: string,
  opts: { includeNonFdle?: boolean } = {}
): DayRoster[] {
  const onDay = (s: WithId<SessionDoc>) => localDateStr(s.start.toDate()) === dateStr;
  const instructional = sessions
    .filter((s) => s.kind !== 'lunch' && onDay(s))
    .filter((s) => (opts.includeNonFdle ? true : s.countsTowardFdle !== false))
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const lunches = sessions.filter((s) => s.kind === 'lunch' && onDay(s));

  // Contiguous same-course runs. Lunch placeholders are already removed, so a
  // course's morning + afternoon blocks are adjacent; a different course breaks it.
  const runs: WithId<SessionDoc>[][] = [];
  for (const b of instructional) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].courseName === b.courseName) last.push(b);
    else runs.push([b]);
  }

  return runs.map((run) => {
    const start = new Date(Math.min(...run.map((s) => s.start.toMillis())));
    const end = new Date(Math.max(...run.map((s) => s.end.toMillis())));
    const classHours = run.reduce((sum, s) => sum + (s.hours ?? 0), 0);

    // Lunch shown on the sheet: a lunch placeholder inside the span, else a
    // per-block lunch carve-out. (Whether it counts toward hours is already baked
    // into each block's stored `hours`, so this is display-only.)
    let lunch = '';
    const placeholder = lunches.find((l) => l.start.toDate() >= start && l.end.toDate() <= end);
    if (placeholder) {
      lunch = `${mil(placeholder.start.toDate())} - ${mil(placeholder.end.toDate())}`;
    } else {
      const carve = run.find((s) => (s.lunchMinutes ?? 0) > 0 && s.lunchStart);
      if (carve) {
        const ls = atTime(carve.start.toDate(), carve.lunchStart!);
        const le = new Date(ls.getTime() + (carve.lunchMinutes ?? 0) * 60000);
        lunch = `${mil(ls)} - ${mil(le)}`;
      }
    }

    const leadSet = new Set<string>();
    const addSet = new Set<string>();
    for (const s of run)
      for (const slot of s.roleSlots ?? []) {
        if (slot.role === 'lead') (slot.filledBy ?? []).forEach((u) => leadSet.add(u));
        else if (ADDITIONAL_INSTRUCTOR_ROLES.includes(slot.role)) (slot.filledBy ?? []).forEach((u) => addSet.add(u));
      }
    leadSet.forEach((u) => addSet.delete(u)); // never list someone twice

    return {
      courseName: run[0].courseName,
      start,
      end,
      timeLabel: `${mil(start)} - ${mil(end)}`,
      classHours,
      lunch,
      leadUids: [...leadSet],
      additionalUids: [...addSet],
    };
  });
}
