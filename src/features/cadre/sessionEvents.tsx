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
} as const;

export function sessionColor(s: SessionDoc): string {
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
}

export function sessionToEvent(s: WithId<SessionDoc>, opts: SessionEventOpts = {}): EventInput {
  const status = sessionColor(s);
  const bg = opts.academyColor ?? status;
  return {
    id: s.id,
    title: `${s.title || s.courseName}${s.room ? ` · ${s.room}` : ''}`,
    start: s.start.toDate(),
    end: s.end.toDate(),
    backgroundColor: bg,
    borderColor: opts.academyColor ? status : bg,
    editable: opts.editable ?? false,
    extendedProps: { session: s, academyPrefix: opts.academyPrefix },
  };
}

/** Compact, two-line-clamped event content (returns undefined → default for holidays). */
export function renderEventContent(arg: EventContentArg): React.ReactNode | undefined {
  const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
  if (!s) return undefined; // holiday label / background events use default rendering
  const prefix = arg.event.extendedProps.academyPrefix as string | undefined;
  return (
    <div className="hd-event">
      {arg.timeText && <div className="hd-event-time">{arg.timeText}</div>}
      <div className="hd-event-title">
        {prefix && <span className="hd-event-acad">{prefix}</span>}
        {s.highLiability && <span aria-label="high liability">▲ </span>}
        {s.title || s.courseName}
      </div>
      {s.room && <div className="hd-event-room">{s.room}</div>}
    </div>
  );
}
