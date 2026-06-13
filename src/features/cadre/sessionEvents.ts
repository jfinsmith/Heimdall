/**
 * Map HEIMDALL sessions to FullCalendar events with staffing-status colors:
 * green = fully staffed, amber = understaffed/open, red = cancelled/critical,
 * gray = draft. High-liability sessions get a horn prefix in the title.
 */
import type { EventInput } from '@fullcalendar/core';
import type { SessionDoc } from '../../types';
import { unfilledSlots } from '../../types';
import type { WithId } from '../../lib/firestore';

export const STATUS_COLORS = {
  staffed: '#15803d',
  open: '#b45309',
  critical: '#b91c1c',
  draft: '#64748b',
  completed: '#374b78',
} as const;

export function sessionColor(s: SessionDoc): string {
  if (s.status === 'cancelled') return STATUS_COLORS.critical;
  if (s.status === 'draft') return STATUS_COLORS.draft;
  if (s.status === 'completed') return STATUS_COLORS.completed;
  return unfilledSlots(s).length === 0 ? STATUS_COLORS.staffed : STATUS_COLORS.open;
}

export function sessionToEvent(
  s: WithId<SessionDoc>,
  opts: { editable?: boolean; academyPrefix?: string } = {}
): EventInput {
  // Title leads with the academy class designation (e.g. "LE 131") so a mixed
  // calendar scans by cohort; FullCalendar renders the start time itself.
  const prefix = opts.academyPrefix ? `${opts.academyPrefix} · ` : '';
  return {
    id: s.id,
    title: `${prefix}${s.highLiability ? '▲ ' : ''}${s.title || s.courseName}${s.room ? ` · ${s.room}` : ''}`,
    start: s.start.toDate(),
    end: s.end.toDate(),
    backgroundColor: sessionColor(s),
    borderColor: sessionColor(s),
    editable: opts.editable ?? false,
    extendedProps: { session: s },
  };
}
