/**
 * CADRE — Schedule Builder (the centerpiece).
 * Per-academy: drag/drop calendar, add sessions from the catalog, recurring
 * generator, per-course hours vs the curriculum minimums, holiday-conflict
 * fixer, two-stage publishing (academy publish → sessions visible; per-course
 * "open sign-ups" → instructors can register), academy editing.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { addDoc, collection, doc, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { addDays, hoursBetween, tsFromDate, fmtDate } from '../../lib/time';
import { holidaysForYear, holidayBackgroundEvents, observedHolidayDatesInRange, HOLIDAY_PAY_HOURS } from '../../lib/holidays';
import type { AcademyDoc, CurriculumDoc, SessionDoc, UserDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { SessionFormModal } from './SessionFormModal';
import { RecurringGeneratorModal } from './RecurringGeneratorModal';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { sessionToEvent, renderEventContent } from './sessionEvents';
import { ACADEMY_COLORS } from '../../lib/academyColors';
import { groupPayPeriods, DEFAULT_PAY_PERIOD_TARGET, q } from '../../lib/payPeriods';
import { useGlobalSettings } from '../../app/providers';
import { logAudit } from '../sessions/audit';

export function AcademyBuilderPage() {
  const { academyId } = useParams<{ academyId: string }>();
  const { firebaseUser } = useAuth();
  const { data: academy } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: curriculum } = useDoc<CurriculumDoc>(academy ? `curricula/${academy.discipline}` : null);
  const { data: sessions } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null,
    [where('academyId', '==', academyId ?? '')],
    [academyId]
  );

  const settings = useGlobalSettings();
  const disabledHolidays = useMemo(() => new Set(settings?.disabledHolidays ?? []), [settings]);
  const observedHolidays = useMemo(() => new Set(settings?.observedHolidays ?? []), [settings]);
  const payTarget = settings?.payPeriodTargetHours ?? DEFAULT_PAY_PERIOD_TARGET;
  const calRef = useRef<FullCalendar>(null);

  const [formSession, setFormSession] = useState<WithId<SessionDoc> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string | undefined>(undefined);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [detailSession, setDetailSession] = useState<WithId<SessionDoc> | null>(null);

  const liveSessions = useMemo(() => sessions.filter((s) => s.status !== 'cancelled'), [sessions]);

  // PSO-observed holidays within the academy add 8.5 hrs of holiday pay each.
  const holidayPayBlocks = useMemo(() => {
    if (!academy || observedHolidays.size === 0) return [];
    return observedHolidayDatesInRange(academy.startDate.toDate(), academy.endDate.toDate(), observedHolidays).map(
      (date) => ({ date, hours: HOLIDAY_PAY_HOURS })
    );
  }, [academy, observedHolidays]);

  // Pay periods: ALL paid time (FDLE + agency + observed-holiday pay), grouped bi-weekly vs the target.
  const payPeriods = useMemo(() => groupPayPeriods(liveSessions, holidayPayBlocks), [liveSessions, holidayPayBlocks]);

  // Live hours readout in the calendar toolbar for whatever range is visible.
  const [viewRange, setViewRange] = useState<{ start: Date; end: Date; type: string } | null>(null);
  const hoursInfo = useMemo(() => {
    if (!viewRange) return null;
    const sessionHours = liveSessions
      .filter((s) => {
        const t = s.start.toMillis();
        return t >= viewRange.start.getTime() && t < viewRange.end.getTime();
      })
      .reduce((a, s) => a + (s.hours || 0), 0);
    // Add observed-holiday pay for any observed holidays in the visible range.
    const holidayHours = observedHolidayDatesInRange(viewRange.start, viewRange.end, observedHolidays).length * HOLIDAY_PAY_HOURS;
    const total = q(sessionHours + holidayHours);
    if (viewRange.type === 'twoWeek') {
      const onTarget = Math.abs(total - payTarget) < 0.01;
      return { text: `Pay period: ${total} / ${payTarget} hrs`, color: onTarget ? '#15803d' : '#b91c1c', bold: true };
    }
    if (viewRange.type === 'timeGridWeek') {
      return { text: `Week: ${total} hrs`, color: '#16203a', bold: true };
    }
    return { text: `${total} hrs in view`, color: '#64748b', bold: false };
  }, [viewRange, liveSessions, payTarget, observedHolidays]);

  // Paint the custom toolbar label imperatively (reliable across FC re-renders).
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = document.querySelector('#builder-calendar .fc-hoursLabel-button') as HTMLElement | null;
      if (el) {
        el.textContent = hoursInfo?.text ?? '';
        el.style.color = hoursInfo?.color ?? 'inherit';
        el.style.fontWeight = hoursInfo?.bold ? '700' : '500';
      }
    });
    return () => cancelAnimationFrame(id);
  }, [hoursInfo]);

  // In the 2-week view, draw a bold black divider on the Monday that starts the
  // second week (separating the two weeks of the pay period).
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = document.getElementById('builder-calendar');
      if (!root) return;
      root.querySelectorAll('.hd-week-split').forEach((e) => e.classList.remove('hd-week-split'));
      if (viewRange?.type !== 'twoWeek') return;
      const mid = new Date(viewRange.start);
      mid.setDate(mid.getDate() + 7);
      const pad = (n: number) => String(n).padStart(2, '0');
      const ds = `${mid.getFullYear()}-${pad(mid.getMonth() + 1)}-${pad(mid.getDate())}`;
      root.querySelectorAll(`[data-date="${ds}"]`).forEach((e) => e.classList.add('hd-week-split'));
    });
    return () => cancelAnimationFrame(id);
  }, [viewRange, showWeekends]);

  /** Jump the calendar to a pay period's two weeks in the 2-week time-grid view. */
  function viewPayPeriod(start: Date) {
    calRef.current?.getApi().changeView('twoWeek', start);
    document.getElementById('builder-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /** Only FDLE-countable sessions feed the program-hours tally — agency-only
   *  blocks (PSO assignments, resiliency days, formation…) are excluded. */
  const fdleSessions = useMemo(() => liveSessions.filter((s) => s.countsTowardFdle !== false), [liveSessions]);
  const scheduledHours = useMemo(() => fdleSessions.reduce((sum, s) => sum + (s.hours || 0), 0), [fdleSessions]);

  const events = useMemo(
    () => [...sessions.map((s) => sessionToEvent(s, { editable: true })), ...holidayBackgroundEvents(disabledHolidays, observedHolidays)],
    [sessions, disabledHolidays, observedHolidays]
  );

  /**
   * Per-curriculum-course progress. Each session is assigned to exactly ONE
   * course (exact name match, since catalog course names == curriculum names)
   * so a session never counts toward two rows — e.g. "DUI Traffic Stops" no
   * longer also inflates "Traffic Stops".
   */
  const courseProgress = useMemo(() => {
    if (!curriculum) return [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const hoursByCourse = new Map<string, number>();
    for (const s of fdleSessions) {
      hoursByCourse.set(norm(s.courseName), (hoursByCourse.get(norm(s.courseName)) ?? 0) + (s.hours || 0));
    }
    return curriculum.courses.map((c) => {
      const scheduled = hoursByCourse.get(norm(c.name)) ?? 0;
      return { ...c, scheduled, delta: scheduled - c.minHours };
    });
  }, [curriculum, fdleSessions]);

  /** Sessions landing on school holidays (the post-clone trap). */
  const holidayConflicts = useMemo(() => {
    const holidayDates = new Map<string, string>();
    for (let y = new Date().getFullYear() - 1; y <= new Date().getFullYear() + 2; y++) {
      for (const h of holidaysForYear(y, disabledHolidays)) holidayDates.set(h.date.toDateString(), h.name);
    }
    return liveSessions
      .map((s) => ({ session: s, holiday: holidayDates.get(s.start.toDate().toDateString()) }))
      .filter((x): x is { session: WithId<SessionDoc>; holiday: string } => !!x.holiday);
  }, [liveSessions]);

  /**
   * Courses grouped for the open-sign-ups control. Only FDLE courses that
   * actually need instructors signing up appear here — custom/agency blocks
   * (coordinator-run, only a coordinator slot) are excluded, so this list
   * mirrors curriculum coverage.
   */
  const courseGroups = useMemo(() => {
    const map = new Map<string, { scheduled: number; open: number; total: number; firstStart: number }>();
    for (const s of liveSessions) {
      if (s.status === 'completed') continue;
      // Skip blocks that only have pre-assigned coordinator slots.
      const needsSignup = s.roleSlots.some((slot) => slot.role !== 'coordinator');
      if (!needsSignup) continue;
      const key = s.courseName;
      const g = map.get(key) ?? { scheduled: 0, open: 0, total: 0, firstStart: Infinity };
      g.total++;
      g.firstStart = Math.min(g.firstStart, s.start.toMillis());
      if (s.status === 'scheduled') g.scheduled++;
      if (s.status === 'open' || s.status === 'fully_staffed') g.open++;
      map.set(key, g);
    }
    // Order by when each course is first taught, not alphabetically.
    return [...map.entries()].sort((a, b) => a[1].firstStart - b[1].firstStart);
  }, [liveSessions]);

  if (!academy) return null;

  const hoursGap = academy.targetTotalHours - scheduledHours;
  const published = academy.status !== 'draft' && academy.status !== 'archived';

  async function onEventChange(arg: EventDropArg | EventResizeDoneArg) {
    const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
    if (!s) return;
    const start = arg.event.start!;
    const end = arg.event.end ?? new Date(start.getTime() + (s.end.toMillis() - s.start.toMillis()));
    await updateDoc(doc(db, 'sessions', s.id), {
      start: tsFromDate(start),
      end: tsFromDate(end),
      // Preserve the lunch carve-out — instructional hours exclude it.
      hours: Math.max(0, hoursBetween(start, end) - (s.lunchMinutes ?? 0) / 60),
      updatedAt: serverTimestamp(),
    });
    if (firebaseUser) {
      await logAudit(firebaseUser.uid, 'session.reschedule', 'session', s.id, `Moved ${s.courseName} to ${start.toLocaleString()}`);
    }
  }

  /** Academy publish: drafts become visible ('scheduled'); unpublish reverses. */
  async function togglePublish() {
    if (!firebaseUser || !academyId) return;
    const next = published ? 'draft' : 'published';
    const batch = writeBatch(db);
    batch.update(doc(db, 'academies', academyId), { status: next, updatedAt: serverTimestamp() });
    for (const s of sessions) {
      if (next === 'published' && s.status === 'draft') {
        batch.update(doc(db, 'sessions', s.id), { status: 'scheduled', updatedAt: serverTimestamp() });
      }
      if (next === 'draft' && (s.status === 'scheduled' || s.status === 'open')) {
        batch.update(doc(db, 'sessions', s.id), { status: 'draft', updatedAt: serverTimestamp() });
      }
    }
    await batch.commit();
    await logAudit(firebaseUser.uid, `academy.${next === 'published' ? 'publish' : 'unpublish'}`, 'academy', academyId, academy!.name);
  }

  /** Open (or close) sign-ups for every session of a course. */
  async function setCourseSignups(courseLabel: string, open: boolean) {
    if (!firebaseUser) return;
    const batch = writeBatch(db);
    let n = 0;
    for (const s of liveSessions) {
      const label = s.title || s.courseName;
      if (label !== courseLabel) continue;
      if (open && s.status === 'scheduled') {
        batch.update(doc(db, 'sessions', s.id), { status: 'open', updatedAt: serverTimestamp() });
        n++;
      }
      if (!open && (s.status === 'open' || s.status === 'fully_staffed')) {
        batch.update(doc(db, 'sessions', s.id), { status: 'scheduled', updatedAt: serverTimestamp() });
        n++;
      }
    }
    await batch.commit();
    if (open && n > 0) {
      // One aggregated event → Gjallarhorn emails each eligible instructor once.
      await addDoc(collection(db, 'coursePublishEvents'), {
        academyId: academyId!,
        courseLabel,
        sessionCount: n,
        requestedBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
    }
    await logAudit(
      firebaseUser.uid,
      open ? 'course.open_signups' : 'course.close_signups',
      'academy',
      academyId!,
      `${open ? 'Opened' : 'Closed'} sign-ups for ${n} "${courseLabel}" sessions`
    );
  }

  /** Move a holiday-conflicted session to the next weekday that is neither a weekend nor a holiday. */
  async function shiftPastHoliday(s: WithId<SessionDoc>) {
    if (!firebaseUser) return;
    const holidaySet = new Set<string>();
    for (let y = new Date().getFullYear() - 1; y <= new Date().getFullYear() + 2; y++) {
      for (const h of holidaysForYear(y, disabledHolidays)) holidaySet.add(h.date.toDateString());
    }
    let start = s.start.toDate();
    let end = s.end.toDate();
    do {
      start = addDays(start, 1);
      end = addDays(end, 1);
    } while (holidaySet.has(start.toDateString()) || start.getDay() === 0 || start.getDay() === 6);
    await updateDoc(doc(db, 'sessions', s.id), {
      start: tsFromDate(start),
      end: tsFromDate(end),
      updatedAt: serverTimestamp(),
    });
    await logAudit(firebaseUser.uid, 'session.shift_holiday', 'session', s.id, `Shifted ${s.courseName} off a holiday to ${start.toLocaleDateString()}`);
  }

  return (
    <div>
      <PageHeader
        back
        kicker="CADRE — Schedule Builder"
        title={academy.shortName ? `${academy.shortName} — ${academy.name}` : academy.name}
        actions={
          <>
            <Button onClick={() => setEditOpen(true)}>Edit academy</Button>
            <Button onClick={() => setRecurringOpen(true)}>Recurring blocks</Button>
            <Button
              variant="primary"
              onClick={() => {
                setFormSession(null);
                setFormDate(undefined);
                setFormOpen(true);
              }}
            >
              Add session
            </Button>
          </>
        }
      />

      {/* Hours tally vs target */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-watch-100 bg-white px-5 py-4 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-watch-500">FDLE hours scheduled</div>
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
          <Badge tone="amber">{hoursGap} hrs remaining</Badge>
        ) : hoursGap < 0 ? (
          <Badge tone="navy">{-hoursGap} hrs over target</Badge>
        ) : (
          <Badge tone="green">Target met exactly</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={published ? 'green' : 'slate'}>{academy.status.replace('_', ' ')}</Badge>
          <Button onClick={togglePublish}>{published ? 'Unpublish' : 'Publish to calendar'}</Button>
          <Link to={`/reports/print/${academy.id}`} className="text-sm text-bifrost-700 hover:underline">
            Print view
          </Link>
        </div>
      </div>

      {/* Pay periods — bi-weekly 85-hr targets (manage overtime) */}
      {payPeriods.length > 0 && <PayPeriodPanel payPeriods={payPeriods} target={payTarget} onView={viewPayPeriod} />}

      {/* Holiday conflicts — the post-clone trap */}
      {holidayConflicts.length > 0 && (
        <section className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-red-800">
            {holidayConflicts.length} session(s) scheduled on school holidays
          </h2>
          <ul className="space-y-1.5">
            {holidayConflicts.map(({ session: s, holiday }) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-900">
                <span>
                  <button className="font-medium hover:underline" onClick={() => setDetailSession(s)}>
                    {s.title || s.courseName}
                  </button>{' '}
                  — {fmtDate(s.start)} is <strong>{holiday}</strong>
                </span>
                <Button onClick={() => shiftPastHoliday(s)}>Shift to next school day</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* Per-course hours vs curriculum minimums */}
        <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">
            Curriculum coverage{curriculum ? ` — ${curriculum.label}` : ''}
          </h2>
          {courseProgress.length === 0 ? (
            <p className="text-sm text-slate-500">
              No curriculum found for this discipline — set one up under Admin → Curriculum &amp; Hours.
            </p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {courseProgress.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-watch-800">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-slate-500">
                      {c.scheduled}/{c.minHours} hrs
                    </span>
                    {c.delta < 0 ? (
                      <Badge tone="amber">{-c.delta} left</Badge>
                    ) : c.delta > 0 ? (
                      <Badge tone="navy">+{c.delta} over</Badge>
                    ) : (
                      <Badge tone="green">met</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Per-course sign-up publishing */}
        <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Course sign-ups</h2>
          <p className="mb-2 text-xs text-slate-500">
            Publishing the academy puts sessions on the calendar; instructors can only register once you
            open each course here (Gjallarhorn notifies eligible instructors).
          </p>
          {!published ? (
            <p className="text-sm text-slate-500">Publish the academy first.</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {courseGroups.map(([label, g]) => (
                <li key={label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-watch-800">{label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {g.open}/{g.total} open
                    </span>
                    {g.scheduled > 0 && (
                      <Button onClick={() => setCourseSignups(label, true)}>Open sign-ups</Button>
                    )}
                    {g.open > 0 && (
                      <Button variant="ghost" onClick={() => setCourseSignups(label, false)}>
                        Close
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div id="builder-calendar" className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="twoWeek"
          initialDate={academy.startDate.toDate() > new Date() ? academy.startDate.toDate() : new Date()}
          firstDay={1}
          weekends={showWeekends}
          views={{ twoWeek: { type: 'timeGrid', duration: { weeks: 2 }, buttonText: '2 weeks' } }}
          customButtons={{ hoursLabel: { text: ' ', click: () => {} } }}
          datesSet={(arg) => setViewRange({ start: arg.start, end: arg.end, type: arg.view.type })}
          headerToolbar={{ left: 'prev,next today', center: 'hoursLabel title', right: 'dayGridMonth,timeGridWeek,twoWeek,timeGridDay,listMonth' }}
          events={events}
          eventContent={renderEventContent}
          editable
          eventDrop={onEventChange}
          eventResize={onEventChange}
          eventClick={(arg) => {
            const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
            if (s) setDetailSession(s);
          }}
          // Click an empty day/slot to add a session prefilled to that date.
          dateClick={(arg) => {
            setFormSession(null);
            setFormDate(arg.dateStr.slice(0, 10));
            setFormOpen(true);
          }}
          height="auto"
          slotMinTime="05:00:00"
          slotMaxTime="22:00:00"
          slotEventOverlap={false}
          expandRows
          listDayFormat={{ weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }}
          listDaySideFormat={false}
          nowIndicator
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Click any empty day or time slot to add a session there. Drag to move, drag edges to resize. ▲ marks high-liability.
          </p>
          <label className="flex items-center gap-2 text-xs text-watch-700">
            <input type="checkbox" checked={showWeekends} onChange={(e) => setShowWeekends(e.target.checked)} />
            Show weekends
          </label>
        </div>
      </div>

      {formOpen && (
        <SessionFormModal academy={academy} session={formSession} defaultDate={formDate} onClose={() => setFormOpen(false)} />
      )}
      {recurringOpen && <RecurringGeneratorModal academy={academy} onClose={() => setRecurringOpen(false)} />}
      {editOpen && <EditAcademyModal academy={academy} onClose={() => setEditOpen(false)} />}
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

/**
 * Pay-period panel: bi-weekly time-on-the-clock vs the 85-hr target. Members
 * must hit the target each pay period; under = short (top up with a PSO
 * assignment), over = overtime (usually avoided).
 */
function PayPeriodPanel({
  payPeriods,
  target,
  onView,
}: {
  payPeriods: ReturnType<typeof groupPayPeriods>;
  target: number;
  onView: (start: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const fmtRange = (start: Date, end: Date) => {
    const last = new Date(end);
    last.setDate(last.getDate() - 1);
    const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString(undefined, o)} – ${last.toLocaleDateString(undefined, o)}`;
  };

  return (
    <section className="mb-4 rounded-lg border border-watch-100 bg-white shadow-sm">
      <button
        className="flex w-full items-center justify-between px-5 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">
          Pay periods — {target}-hr bi-weekly target
        </h2>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'} ▾</span>
      </button>
      {open && (
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-watch-500">
              <tr>
                <th className="px-3 py-2">Pay period</th>
                <th className="px-3 py-2 text-right">Wk 1</th>
                <th className="px-3 py-2 text-right">Wk 2</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-watch-50">
              {payPeriods.map((pp) => {
                const total = q(pp.totalHours);
                const delta = q(total - target);
                const tone = delta === 0 ? 'green' : delta < 0 ? 'amber' : 'red';
                const label =
                  delta === 0
                    ? 'On target'
                    : delta < 0
                      ? `${-delta} hr short — add PSO`
                      : `${delta} hr overtime`;
                return (
                  <tr key={pp.key} className="hover:bg-watch-50/50">
                    <td className="px-3 py-2 font-medium text-watch-900">{fmtRange(pp.start, pp.end)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{q(pp.week1Hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{q(pp.week2Hours)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{total}</td>
                    <td className="px-3 py-2">
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" onClick={() => onView(pp.start)}>
                        View 2 wks
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 pt-2 text-xs text-slate-500">
            Counts all paid time (courses, PT, formation, PSO) plus {HOLIDAY_PAY_HOURS} hrs for each
            PSO-observed holiday. Lunch is excluded. Sworn members owe {target} hours per pay period; short
            periods are typically topped up with a Friday PSO assignment.
          </p>
        </div>
      )}
    </section>
  );
}

/** Edit the academy itself (designation, name, discipline, color, room, hours, coordinators). */
function EditAcademyModal({ academy, onClose }: { academy: WithId<AcademyDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const { data: coordinators } = useCollection<UserDoc>('users', [where('role', '==', 'coordinator')]);
  const { data: curricula } = useCollection<CurriculumDoc>('curricula', [where('active', '==', true)]);
  const [name, setName] = useState(academy.name);
  const [shortName, setShortName] = useState(academy.shortName ?? '');
  const [discipline, setDiscipline] = useState(academy.discipline ?? '');
  const [color, setColor] = useState(academy.color ?? ACADEMY_COLORS[0].value);
  const [defaultRoom, setDefaultRoom] = useState(academy.defaultRoom ?? '');
  const [targetHours, setTargetHours] = useState(academy.targetTotalHours);
  const [primary, setPrimary] = useState(academy.coordinatorIds[0] ?? '');
  const [secondary, setSecondary] = useState(academy.coordinatorIds[1] ?? '');
  const [busy, setBusy] = useState(false);

  // If the discipline isn't among the active curricula (e.g. an older value),
  // still offer it so the field is never blank/unrecoverable.
  const disciplineOptions = useMemo(() => {
    const opts = curricula.map((c) => ({ id: c.id, label: c.label }));
    if (discipline && !opts.some((o) => o.id === discipline)) opts.unshift({ id: discipline, label: discipline });
    return opts;
  }, [curricula, discipline]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const curriculum = curricula.find((c) => c.id === discipline);
    await updateDoc(doc(db, 'academies', academy.id), {
      name,
      shortName,
      discipline,
      color,
      fdleProgram: curriculum?.fdleProgram ?? academy.fdleProgram,
      defaultRoom,
      targetTotalHours: targetHours,
      // [0] = primary, [1] = secondary; drop empties and de-dup.
      coordinatorIds: [...new Set([primary, secondary].filter(Boolean))],
      updatedAt: serverTimestamp(),
    });
    await logAudit(firebaseUser!.uid, 'academy.update', 'academy', academy.id, `Edited ${name}`);
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Edit academy">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <Field label="Class designation">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} required />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Discipline" hint="Drives curriculum coverage & default hours">
            <Select
              value={discipline}
              onChange={(e) => {
                setDiscipline(e.target.value);
                const c = curricula.find((x) => x.id === e.target.value);
                if (c) setTargetHours(c.totalHours);
              }}
            >
              <option value="">Select…</option>
              {disciplineOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Calendar color">
            <div className="flex items-center gap-2">
              <Select value={color} onChange={(e) => setColor(e.target.value)} className="flex-1">
                {ACADEMY_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>{c.name}</option>
                ))}
              </Select>
              <span className="h-7 w-7 shrink-0 rounded-md ring-1 ring-watch-200" style={{ backgroundColor: color }} />
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default room" hint="Prefilled on new sessions">
            <Input value={defaultRoom} onChange={(e) => setDefaultRoom(e.target.value)} />
          </Field>
          <Field label="Target total hours">
            <Input type="number" min={1} value={targetHours} onChange={(e) => setTargetHours(Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary coordinator" hint="Default owner for assigned blocks">
            <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">— none —</option>
              {coordinators.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Secondary coordinator">
            <Select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              <option value="">— none —</option>
              {coordinators.filter((u) => u.id !== primary).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
