import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { assignmentToVevent, buildIcs, foldLine } from './ics';
import type { AssignmentDoc } from '../types';
import type { WithId } from './firestore';

const assignment = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1_alice',
    courseName: 'Legal',
    role: 'lead',
    location: 'East Campus',
    room: 'E-120',
    start: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 9, 13, 0))),
    end: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 9, 21, 30))),
    ...over,
  }) as unknown as WithId<AssignmentDoc>;
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('assignmentToVevent', () => {
  it('writes absolute UTC instants, so the event is right in any viewer time zone', () => {
    const v = assignmentToVevent(assignment());
    expect(v).toContain('DTSTART:20261109T130000Z');
    expect(v).toContain('DTEND:20261109T213000Z');
    expect(v.split('\r\n')[0]).toBe('BEGIN:VEVENT');
  });
  it('escapes backslash, semicolon, comma and every kind of line break', () => {
    const v = assignmentToVevent(assignment({ courseName: 'Crimes; Persons, Property\\Society', location: 'Bldg A\r\nRange 2\rBay 1\nLane 3', room: '' }));
    expect(v).toContain('SUMMARY:Crimes\\; Persons\\, Property\\\\Society (lead)');
    expect(v).toContain('LOCATION:Bldg A\\nRange 2\\nBay 1\\nLane 3');
    // No raw CR/LF survives inside a property value.
    for (const line of v.split('\r\n')) expect(line).not.toMatch(/[\r\n]/);
  });
});

describe('foldLine (RFC 5545 §3.1)', () => {
  it('leaves a line of 75 octets or fewer alone', () => {
    const line = 'SUMMARY:' + 'x'.repeat(67);
    expect(bytes(line)).toBe(75);
    expect(foldLine(line)).toBe(line);
  });
  it('folds longer lines to ≤ 75 octets each, continuation lines starting with one space, losslessly', () => {
    const line = 'SUMMARY:' + 'Conducted Electrical Weapon/Dart-Firing Stun Gun — Peña, José '.repeat(4);
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    // Unfolding (drop CRLF + the one space) restores the original exactly.
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
  it('never splits a multi-byte character or a surrogate pair', () => {
    const folded = foldLine('DESCRIPTION:' + '—é🚓'.repeat(40));
    expect(folded).not.toContain('\uFFFD');
    expect(folded.replace(/\r\n /g, '')).toBe('DESCRIPTION:' + '—é🚓'.repeat(40));
  });
});

describe('buildIcs', () => {
  it('wraps the events in one CRLF-delimited VCALENDAR', () => {
    const ics = buildIcs([assignment(), assignment({ id: 's2_alice' })]);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(ics).toContain('UID:s2_alice@heimdall');
  });
});
