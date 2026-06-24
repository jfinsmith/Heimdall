/**
 * Map HEIMDALL sessions to FullCalendar events + a compact event renderer.
 *
 * Two coloring modes:
 *  - status (builder, single academy): green/amber/red/navy/gray by staffing
 *  - academy (multi-academy calendar): the cohort's assigned color as the
 *    background, with a thin status-colored border so staffing still reads
 *
 * `renderEventContent` keeps cells tidy: small time line, course title clamped
 * to two lines, room on its own muted line — instead of one long wrapped blob.
 */
import React from 'react';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import type { SessionDoc } from '../../types';
import { unfilledSlots } from '../../types';
import type { WithId } from '../../lib/firestore';

export const STATUS_COLORS = {
  staffed: '#15803d',
  open: '#b45309',
  critical: '#b91c1c',
  draft: '#64748b',
  scheduled: '#374b78',
  completed: '#16203a',
  lunch: '#78716c', // warm gray — reads as a neutral break, not a class
} as const;

export function sessionColor(s: SessionDoc): string {
  if (s.kind === 'lunch') return STATUS_COLORS.lunch;
  if (s.status === 'cancelled') return STATUS_COLORS.critical;
  if (s.status === 'draft') return STATUS_COLORS.draft;
  if (s.status === 'scheduled') return STATUS_COLORS.scheduled;
  if (s.status === 'completed') return STATUS_COLORS.completed;
  return unfilledSlots(s).length === 0 ? STATUS_COLORS.staffed : STATUS_COLORS.open;
}

export interface SessionEventOpts {
  editable?: boolean;
  /** Short academy designation shown inline (e.g. "LE 131"). */
  academyPrefix?: string;
  /** When set, the event background uses the academy color; border = status. */
  academyColor?: string;
  /** Cumulative curriculum-coverage tag for the builder, e.g. "6/12" — hours of
   *  this course scheduled up to and including this block / the course minimum. */
  coverage?: string;
}

/**
 * Highlight on calendar blocks: TEST → red, SCENARIO → green, PT (e.g.
 * "PT Assessment") → yellow. Matches the block's course/assignment NAME, its
 * title override, AND its notes — so the flag fires whether the word is the
 * block name (e.g. a custom "PT Assessment" block) or typed into the notes.
 * Precedence when more than one appears: test (red) > scenario (green) > PT
 * (yellow), since a graded test is the most critical to flag.
 */
export type SessionFlag = 'test' | 'scenario' | 'pt';
export function sessionFlag(s: SessionDoc): SessionFlag | null {
  const hay = `${s.courseName ?? ''} ${s.title ?? ''} ${s.notes ?? ''}`;
  if (/\btest/i.test(hay)) return 'test';
  if (/\bscenario/i.test(hay)) return 'scenario';
  if (/\bPT\b/i.test(hay)) return 'pt';
  return null;
}

export function sessionToEvent(s: WithId<SessionDoc>, opts: SessionEventOpts = {}): EventInput {
  const status = sessionColor(s);
  const bg = opts.academyColor ?? status;
  return {
    id: s.id,
    title: s.courseName,
    // Guard against malformed sessions (missing start/end): a bad doc yields an
    // event FullCalendar skips, instead of throwing during the map and blanking
    // the whole calendar.
    start: s.start?.toDate(),
    end: s.end?.toDate(),
    backgroundColor: bg,
    borderColor: opts.academyColor ? status : bg,
    classNames: (() => {
      const flag = sessionFlag(s);
      return flag ? ['hd-flagged', `hd-flagged--${flag}`] : [];
    })(),
    editable: opts.editable ?? false,
    extendedProps: { session: s, academyPrefix: opts.academyPrefix, coverage: opts.coverage },
  };
}

/**
 * Event content renderer. Returns undefined for holiday/background events (FC
 * default). Very short blocks (≤20 min, e.g. Formation) render a single
 * shrink-to-fit title line so the name is still legible; longer blocks show
 * time, academy badge, course, notes, and room.
 */
export function renderEventContent(arg: EventContentArg): React.ReactNode | undefined {
  // Holidays: render the name explicitly (bold black). FullCalendar v6 renders
  // an EMPTY event when eventContent returns undefined — it does not fall back
  // to default — which previously collapsed the label to an invisible line.
  if (arg.event.extendedProps.holiday) {
    const pay = arg.event.extendedProps.observedPay as number | undefined;
    if (arg.event.display === 'background') {
      // Plain wash unless this is the builder's timed body-label, and only in a
      // time-grid view (in month/list the all-day label carries the name).
      const isTimeGrid = arg.view.type.startsWith('timeGrid') || arg.view.type === 'twoWeek';
      if (!arg.event.extendedProps.holidayBodyLabel || !isTimeGrid) return undefined;
      return (
        <div className="hd-holiday-grid-label">
          {arg.event.title}
          {pay ? <span className="hd-holiday-pay"> · +{pay} hr pay</span> : null}
        </div>
      );
    }
    return (
      <div className="hd-holiday-label">
        {arg.event.title}
        {pay ? <span className="hd-holiday-pay"> · +{pay} hr pay</span> : null}
      </div>
    );
  }

  const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
  if (!s) return undefined;
  const prefix = arg.event.extendedProps.academyPrefix as string | undefined;
  const coverage = arg.event.extendedProps.coverage as string | undefined;
  // FullCalendar sets event.end to null when a session's end is <= its start
  // (zero/negative-duration bad data). Never dereference null — fall back to the
  // session's own timestamps — so one malformed session can't crash the calendar.
  const startMs = arg.event.start?.getTime() ?? s.start?.toMillis() ?? 0;
  const endMs = arg.event.end?.getTime() ?? s.end?.toMillis() ?? startMs;
  const durationMin = (endMs - startMs) / 60000;

  // Lunch / break placeholders: a simple labelled block, never the full
  // course/staffing chrome (regardless of how short the block is).
  if (s.kind === 'lunch') {
    return (
      <div className="hd-event hd-event--lunch" title={`${s.courseName}${arg.timeText ? ` · ${arg.timeText}` : ''}`}>
        <span className="hd-event-tiny-title">🍴 {s.courseName}</span>
      </div>
    );
  }

  if (durationMin <= 20) {
    return (
      <div className="hd-event hd-event--tiny" title={`${s.courseName}${s.notes ? ` — ${s.notes}` : ''}`}>
        <span className="hd-event-tiny-title">
          {s.highLiability && '▲ '}
          {s.courseName}
        </span>
      </div>
    );
  }

  // In time-grid views (incl. the custom 2-week view, whose type is "twoWeek"),
  // draw the lunch break as a white band at the right vertical position.
  const isTimeGrid = arg.view.type.startsWith('timeGrid') || arg.view.type === 'twoWeek';
  let lunchBand: React.ReactNode = null;
  if (s.lunchMinutes && s.lunchStart && isTimeGrid && arg.event.start && durationMin > 0) {
    const start = arg.event.start;
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = startMin + durationMin;
    const [lh, lm] = s.lunchStart.split(':').map(Number);
    const lunchStartMin = lh * 60 + lm;
    if (lunchStartMin >= startMin && lunchStartMin + s.lunchMinutes <= endMin) {
      const top = ((lunchStartMin - startMin) / durationMin) * 100;
      const height = (s.lunchMinutes / durationMin) * 100;
      lunchBand = (
        <div className="hd-lunch" style={{ top: `${top}%`, height: `${height}%` }} aria-hidden>
          <span>lunch</span>
        </div>
      );
    }
  }

  return (
    <div className="hd-event">
      {lunchBand}
      {arg.timeText && <div className="hd-event-time">{arg.timeText}</div>}
      <div className="hd-event-title">
        {prefix && <span className="hd-event-acad">{prefix}</span>}
        {s.highLiability && <span aria-label="high liability">▲ </span>}
        {s.courseName}
      </div>
      {s.notes && <div className="hd-event-notes">{s.notes}</div>}
      {s.room && <div className="hd-event-room">{s.room}</div>}
      {/* Lunch line only when there's actually a lunch break. */}
      {s.lunchMinutes ? (
        <div className="hd-event-room">
          lunch {s.lunchMinutes}m{s.lunchStart ? ` · ${s.lunchStart}` : ''}
        </div>
      ) : null}
      {coverage && (
        <div className="hd-event-room" style={{ fontWeight: 600 }} title="Cumulative hours scheduled for this course so far">
          {coverage} hrs
        </div>
      )}
    </div>
  );
}
