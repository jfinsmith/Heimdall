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
    title: s.courseName,
    start: s.start.toDate(),
    end: s.end.toDate(),
    backgroundColor: bg,
    borderColor: opts.academyColor ? status : bg,
    editable: opts.editable ?? false,
    extendedProps: { session: s, academyPrefix: opts.academyPrefix },
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
    if (arg.event.display === 'background') return undefined; // the red wash, no text
    return <div className="hd-holiday-label">{arg.event.title}</div>;
  }

  const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
  if (!s) return undefined;
  const prefix = arg.event.extendedProps.academyPrefix as string | undefined;
  const durationMin = (arg.event.end!.getTime() - arg.event.start!.getTime()) / 60000;

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

  // In time-grid views, draw the lunch break as a white band at the right
  // vertical position within the block.
  let lunchBand: React.ReactNode = null;
  if (s.lunchMinutes && s.lunchStart && arg.view.type.startsWith('timeGrid')) {
    const start = arg.event.start!;
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
    </div>
  );
}
