/**
 * CADRE — Schedule Builder (the centerpiece).
 * Per-academy: drag/drop calendar, add sessions from the catalog, recurring
 * generator, hours tally vs target, publish/unpublish.
 */
import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { doc, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { hoursBetween, tsFromDate } from '../../lib/time';
import type { AcademyDoc, SessionDoc } from '../../types';
import { Badge, Button, PageHeader, HighLiabilityBadge } from '../../components/ui';
import { SessionFormModal } from './SessionFormModal';
import { RecurringGeneratorModal } from './RecurringGeneratorModal';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { sessionToEvent } from './sessionEvents';
import { holidayBackgroundEvents } from '../../lib/holidays';
import { logAudit } from '../sessions/audit';

export function AcademyBuilderPage() {
  const { academyId } = useParams<{ academyId: string }>();
  const { firebaseUser } = useAuth();
  const { data: academy } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: sessions } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null,
    [where('academyId', '==', academyId ?? '')],
    [academyId]
  );

  const [formSession, setFormSession] = useState<WithId<SessionDoc> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [detailSession, setDetailSession] = useState<WithId<SessionDoc> | null>(null);

  const scheduledHours = useMemo(
    () => sessions.filter((s) => s.status !== 'cancelled').reduce((sum, s) => sum + (s.hours || 0), 0),
    [sessions]
  );

  const events = useMemo(
    () => [...sessions.map((s) => sessionToEvent(s, { editable: true })), ...holidayBackgroundEvents()],
    [sessions]
  );

  if (!academy) return null;

  const hoursGap = academy.targetTotalHours - scheduledHours;
  const published = academy.status !== 'draft' && academy.status !== 'archived';

  /** Drag/resize writes the new window straight back to Firestore. */
  async function onEventChange(arg: EventDropArg | EventResizeDoneArg) {
    const s = arg.event.extendedProps.session as WithId<SessionDoc>;
    const start = arg.event.start!;
    const end = arg.event.end ?? new Date(start.getTime() + (s.end.toMillis() - s.start.toMillis()));
    await updateDoc(doc(db, 'sessions', s.id), {
      start: tsFromDate(start),
      end: tsFromDate(end),
      hours: hoursBetween(start, end),
      updatedAt: serverTimestamp(),
    });
    if (firebaseUser) {
      await logAudit(firebaseUser.uid, 'session.reschedule', 'session', s.id, `Moved ${s.courseName} to ${start.toLocaleString()}`);
    }
  }

  async function togglePublish() {
    if (!firebaseUser || !academyId) return;
    const next = published ? 'draft' : 'published';
    const batch = writeBatch(db);
    batch.update(doc(db, 'academies', academyId), { status: next, updatedAt: serverTimestamp() });
    // Draft sessions open up on publish; open-but-unstaffed return to draft on unpublish.
    for (const s of sessions) {
      if (next === 'published' && s.status === 'draft') {
        batch.update(doc(db, 'sessions', s.id), { status: 'open', updatedAt: serverTimestamp() });
      }
      if (next === 'draft' && s.status === 'open') {
        batch.update(doc(db, 'sessions', s.id), { status: 'draft', updatedAt: serverTimestamp() });
      }
    }
    await batch.commit();
    await logAudit(firebaseUser.uid, `academy.${next === 'published' ? 'publish' : 'unpublish'}`, 'academy', academyId, academy!.name);
  }

  return (
    <div>
      <PageHeader
        back
        kicker="CADRE — Schedule Builder"
        title={academy.shortName ? `${academy.shortName} — ${academy.name}` : academy.name}
        actions={
          <>
            <Button onClick={() => setRecurringOpen(true)}>Recurring blocks</Button>
            <Button
              variant="primary"
              onClick={() => {
                setFormSession(null);
                setFormOpen(true);
              }}
            >
              Add session
            </Button>
          </>
        }
      />

      {/* Hours tally vs target, with gap warning */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-watch-100 bg-white px-5 py-4 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-watch-500">Scheduled hours</div>
          <div className="text-2xl font-bold text-watch-900">
            {scheduledHours}
            <span className="text-base font-normal text-slate-400"> / {academy.targetTotalHours}</span>
          </div>
        </div>
        <div className="h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-watch-100" role="progressbar"
          aria-valuenow={scheduledHours} aria-valuemax={academy.targetTotalHours} aria-label="Scheduled hours progress">
          <div
            className={`h-full ${hoursGap > 0 ? 'bg-bifrost-500' : 'bg-status-staffed'}`}
            style={{ width: `${Math.min(100, (scheduledHours / academy.targetTotalHours) * 100)}%` }}
          />
        </div>
        {hoursGap > 0 ? (
          <Badge tone="amber">{hoursGap} hrs short of target</Badge>
        ) : (
          <Badge tone="green">Target met{hoursGap < 0 ? ` (+${-hoursGap} hrs)` : ''}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={published ? 'green' : 'slate'}>{academy.status.replace('_', ' ')}</Badge>
          <Button onClick={togglePublish}>{published ? 'Unpublish' : 'Publish'}</Button>
          <Link to={`/reports/print/${academy.id}`} className="text-sm text-bifrost-700 hover:underline">
            Print view
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          initialDate={academy.startDate.toDate()}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          events={events}
          editable
          eventDrop={onEventChange}
          eventResize={onEventChange}
          eventClick={(arg) => {
            const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
            if (s) setDetailSession(s); // holiday background events carry no session
          }}
          height="auto"
          slotMinTime="05:00:00"
          slotMaxTime="22:00:00"
          nowIndicator
        />
        <p className="mt-2 text-xs text-slate-400">
          Drag to move, drag edges to resize — changes save immediately. <HighLiabilityBadge /> sessions show a ▲ marker.
        </p>
      </div>

      {formOpen && <SessionFormModal academy={academy} session={formSession} onClose={() => setFormOpen(false)} />}
      {recurringOpen && <RecurringGeneratorModal academy={academy} onClose={() => setRecurringOpen(false)} />}
      {detailSession && (
        <SessionDetailModal
          sessionId={detailSession.id}
          onClose={() => setDetailSession(null)}
          onEdit={(s) => {
            setDetailSession(null);
            setFormSession(s);
            setFormOpen(true);
          }}
        />
      )}
    </div>
  );
}
