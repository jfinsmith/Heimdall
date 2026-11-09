/**
 * Gjallarhorn — personal ICS calendar feed.
 *
 * Instructors subscribe their phone/Outlook/Google Calendar to
 *   https://us-east1-<project>.cloudfunctions.net/calendarFeed?uid=<uid>&token=<icsToken>
 * and their confirmed HEIMDALL assignments sync perpetually. The token is a
 * random secret stored on the user's own doc (rules let only the owner set it);
 * uid+token must match, so the URL is unguessable without both.
 *
 * This is an UNAUTHENTICATED surface: anyone holding the URL sees that member's
 * assignments (course, role, location, times) for as long as the token stays
 * on the doc. It therefore follows the account lockout — a suspended or
 * deactivated member's feed stops serving.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import type { AssignmentDoc, UserDoc } from '../types';

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r/g, '').replace(/\n/g, '\\n');
}

export const calendarFeed = onRequest({ cors: true }, async (req, res) => {
  const uid = String(req.query.uid ?? '');
  const token = String(req.query.token ?? '');
  if (!uid || !token) {
    res.status(400).send('Missing uid/token');
    return;
  }

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  const user = userSnap.exists ? (userSnap.data() as UserDoc) : null;
  if (!user || !user.icsToken || user.icsToken !== token) {
    res.status(403).send('Invalid calendar token');
    return;
  }
  // Token checked FIRST so this never reveals an account's status to a guesser.
  if (user.status === 'suspended' || user.status === 'inactive') {
    res.status(403).send('Calendar feed unavailable');
    return;
  }

  const assignments = await getFirestore()
    .collection('assignments')
    .where('uid', '==', uid)
    .where('status', '==', 'confirmed')
    .get();

  const events = assignments.docs
    // One malformed mirror (no times) must not 500 the whole subscription.
    .filter((d) => d.data().start && d.data().end)
    .map((d) => {
      const a = d.data() as AssignmentDoc;
      // A coordinator's reservation the member hasn't answered is an OFFER, not
      // an accepted assignment (same rule as reminders and bulk messages) — show
      // it as tentative rather than as a firm commitment.
      const pending = a.reservationState === 'pending';
      return [
        'BEGIN:VEVENT',
        `UID:${d.id}@heimdall`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(a.start.toDate())}`,
        `DTEND:${icsDate(a.end.toDate())}`,
        `SUMMARY:${escapeText(`${pending ? 'PENDING — ' : ''}${a.courseName ?? ''} (${(a.role ?? '').replace('_', ' ')})`)}`,
        `LOCATION:${escapeText(`${a.location ?? ''}${a.room ? ` — ${a.room}` : ''}`)}`,
        ...(pending
          ? ['STATUS:TENTATIVE', `DESCRIPTION:${escapeText('A coordinator reserved this slot for you — confirm or decline it on My Schedule in HEIMDALL.')}`]
          : ['DESCRIPTION:HEIMDALL training assignment. Sounded by Gjallarhorn.']),
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
