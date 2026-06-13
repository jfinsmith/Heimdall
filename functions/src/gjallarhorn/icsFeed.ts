/**
 * Gjallarhorn — personal ICS calendar feed.
 *
 * Instructors subscribe their phone/Outlook/Google Calendar to
 *   https://us-east1-<project>.cloudfunctions.net/calendarFeed?uid=<uid>&token=<icsToken>
 * and their confirmed HEIMDALL assignments sync perpetually. The token is a
 * random secret stored on the user's own doc (rules let only the owner set it);
 * uid+token must match, so the URL is unguessable without both.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import type { AssignmentDoc, UserDoc } from '../types';

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export const calendarFeed = onRequest({ cors: true }, async (req, res) => {
  const uid = String(req.query.uid ?? '');
  const token = String(req.query.token ?? '');
  if (!uid || !token) {
    res.status(400).send('Missing uid/token');
    return;
  }

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  const user = userSnap.exists ? (userSnap.data() as UserDoc & { icsToken?: string }) : null;
  if (!user || !user.icsToken || user.icsToken !== token) {
    res.status(403).send('Invalid calendar token');
    return;
  }

  const assignments = await getFirestore()
    .collection('assignments')
    .where('uid', '==', uid)
    .where('status', '==', 'confirmed')
    .get();

  const events = assignments.docs.map((d) => {
    const a = d.data() as AssignmentDoc;
    return [
      'BEGIN:VEVENT',
      `UID:${d.id}@heimdall`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(a.start.toDate())}`,
      `DTEND:${icsDate(a.end.toDate())}`,
      `SUMMARY:${escapeText(`${a.courseName} (${a.role.replace('_', ' ')})`)}`,
      `LOCATION:${escapeText(`${a.location}${a.room ? ` — ${a.room}` : ''}`)}`,
      'DESCRIPTION:HEIMDALL training assignment. Sounded by Gjallarhorn.',
      'END:VEVENT',
    ].join('\r\n');
  });

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HEIMDALL//Gjallarhorn//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:HEIMDALL — My Assignments',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(body);
});
