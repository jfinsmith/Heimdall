/**
 * My Schedule — confirmed assignments as a list or personal calendar, with
 * one-off .ics download, a perpetual calendar-feed subscription URL, and
 * withdraw.
 */
import React, { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import { doc, orderBy, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { downloadIcs } from '../../lib/ics';
import { fmtRange } from '../../lib/time';
import type { AssignmentDoc } from '../../types';
import { SLOT_ROLE_LABELS } from '../../types';
import { Button, EmptyState, PageHeader } from '../../components/ui';
import { withdrawFromSession } from '../sessions/useSignup';
import { SessionDetailModal } from '../sessions/SessionDetailModal';

// TODO(setup): update if you change Firebase project or move regions.
const FEED_BASE = 'https://us-east1-heimdall-e1f03.cloudfunctions.net/calendarFeed';

export function MySchedulePage() {
  const { firebaseUser, profile } = useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [copied, setCopied] = useState(false);

  const { data: assignments } = useCollection<AssignmentDoc>(
    firebaseUser ? 'assignments' : null,
    [where('uid', '==', firebaseUser?.uid ?? ''), where('status', '==', 'confirmed'), orderBy('start')],
    [firebaseUser?.uid]
  );
  const upcoming = assignments.filter((a) => a.end.toMillis() > Date.now());
  const past = assignments.filter((a) => a.end.toMillis() <= Date.now());

  const events = useMemo(
    () =>
      assignments.map((a) => ({
        id: a.sessionId,
        title: `${a.courseName} (${SLOT_ROLE_LABELS[a.role]})`,
        start: a.start.toDate(),
        end: a.end.toDate(),
        backgroundColor: '#15803d',
        borderColor: '#15803d',
      })),
    [assignments]
  );

  async function withdraw(sessionId: string) {
    if (!firebaseUser) return;
    if (!window.confirm('Withdraw from this session? The coordinators will be notified.')) return;
    setBusy(sessionId);
    try {
      await withdrawFromSession(firebaseUser.uid, sessionId);
    } finally {
      setBusy(null);
    }
  }

  /** Generate (once) and copy the perpetual calendar-subscription URL. */
  async function copyFeedUrl() {
    if (!firebaseUser) return;
    let token = profile?.icsToken;
    if (!token) {
      token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
      await updateDoc(doc(db, 'users', firebaseUser.uid), { icsToken: token, updatedAt: serverTimestamp() });
    }
    await navigator.clipboard.writeText(`${FEED_BASE}?uid=${firebaseUser.uid}&token=${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div>
      <PageHeader
        kicker="Instructor"
        title="My Schedule"
        actions={
          <>
            <div className="flex overflow-hidden rounded-md ring-1 ring-watch-200">
              {(['list', 'calendar'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`px-3 py-1.5 text-sm capitalize ${view === v ? 'bg-watch-800 text-bifrost-300' : 'bg-white text-slate-600'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button onClick={() => downloadIcs('heimdall-my-schedule', upcoming)} disabled={upcoming.length === 0}>
              Export .ics
            </Button>
            <Button onClick={copyFeedUrl} title="Paste into Google Calendar / Outlook 'subscribe by URL' — stays in sync automatically">
              {copied ? 'Copied!' : 'Copy calendar feed URL'}
            </Button>
          </>
        }
      />
      <p className="mb-4 -mt-3 text-xs text-slate-500">
        The feed URL can be added to Google Calendar ("From URL"), Apple Calendar, or Outlook as a
        subscribed calendar — everything you sign up for syncs automatically.
      </p>

      {view === 'calendar' ? (
        <div className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
            events={events}
            eventClick={(arg) => setDetailId(arg.event.id)}
            height="auto"
            slotEventOverlap={false}
            nowIndicator
          />
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyState title="No upcoming assignments" body="Sign up for sessions under Browse Open Sessions." />
      ) : (
        <ul className="space-y-3">
          {upcoming.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
              <div>
                <button className="text-left font-semibold text-watch-900 hover:underline" onClick={() => setDetailId(a.sessionId)}>
                  {a.courseName}
                </button>
                <div className="text-sm text-slate-500">
                  {fmtRange(a.start, a.end)} · {a.location}
                  {a.room ? ` — ${a.room}` : ''} · {SLOT_ROLE_LABELS[a.role]}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => downloadIcs(`heimdall-${a.courseName.toLowerCase().replace(/\W+/g, '-')}`, [a])}>
                  .ics
                </Button>
                <Button variant="danger" disabled={busy === a.sessionId} onClick={() => withdraw(a.sessionId)}>
                  Withdraw
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === 'list' && past.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-watch-600">Past assignments</h2>
          <ul className="divide-y divide-watch-50 rounded-lg border border-watch-100 bg-white shadow-sm">
            {past.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-watch-800">{a.courseName}</span>
                <span className="text-slate-400">{fmtRange(a.start, a.end)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
