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
  // CRLF / bare CR count as line breaks too — a raw CR would end the property.
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding: a content line is at most 75 OCTETS; longer lines
 * continue on the next line after CRLF + one space. Measured in UTF-8 bytes and
 * split between code points, so a multi-byte character is never cut in half.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // Continuation lines spend one octet on the leading space.
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
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
  return lines.map(foldLine).join('\r\n');
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
