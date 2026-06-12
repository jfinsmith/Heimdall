/**
 * Minimal .ics (iCalendar) generation for "add to calendar" exports —
 * no dependency needed for VEVENT generation.
 */
import type { AssignmentDoc } from '../types';
import type { WithId } from './firestore';

function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function assignmentToVevent(a: WithId<AssignmentDoc>): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${a.id}@heimdall`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(a.start.toDate())}`,
    `DTEND:${icsDate(a.end.toDate())}`,
    `SUMMARY:${escapeText(`${a.courseName} (${a.role})`)}`,
    `LOCATION:${escapeText(`${a.location}${a.room ? ` — ${a.room}` : ''}`)}`,
    `DESCRIPTION:${escapeText('HEIMDALL training assignment. Sounded by Gjallarhorn.')}`,
    'END:VEVENT',
  ];
  return lines.join('\r\n');
}

export function buildIcs(assignments: WithId<AssignmentDoc>[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HEIMDALL//Gjallarhorn//EN',
    'CALSCALE:GREGORIAN',
    ...assignments.map(assignmentToVevent),
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Trigger a browser download of an .ics file. */
export function downloadIcs(filename: string, assignments: WithId<AssignmentDoc>[]): void {
  const blob = new Blob([buildIcs(assignments)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
