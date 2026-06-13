/**
 * CADRE — Schedule Builder (the centerpiece).
 * Per-academy: drag/drop calendar, add sessions from the catalog, recurring
 * generator, per-course hours vs the curriculum minimums, holiday-conflict
 * fixer, two-stage publishing (academy publish → sessions visible; per-course
 * "open sign-ups" → instructors can register), academy editing.
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
import { addDoc, collection, doc, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { addDays, hoursBetween, tsFromDate, fmtDate } from '../../lib/time';
import { holidaysForYear, holidayBackgroundEvents } from '../../lib/holidays';
import type { AcademyDoc, CurriculumDoc, SessionDoc, UserDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { SessionFormModal } from './SessionFormModal';
import { RecurringGeneratorModal } from './RecurringGeneratorModal';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { sessionToEvent, renderEventContent } from './sessionEvents';
import { ACADEMY_COLORS } from '../../lib/academyColors';
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

  const [formSession, setFormSession] = useState<WithId<SessionDoc> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [detailSession, setDetailSession] = useState<WithId<SessionDoc> | null>(null);

  const liveSessions = useMemo(() => sessions.filter((s) => s.status !== 'cancelled'), [sessions]);
  /** Only FDLE-countable sessions feed the program-hours tally — agency-only
   *  blocks (PSO assignments, resiliency days, formation…) are excluded. */
  const fdleSessions = useMemo(() => liveSessions.filter((s) => s.countsTowardFdle !== false), [liveSessions]);
  const scheduledHours = useMemo(() => fdleSessions.reduce((sum, s) => sum + (s.hours || 0), 0), [fdleSessions]);

  const events = useMemo(
    () => [...sessions.map((s) => sessionToEvent(s, { editable: true })), ...holidayBackgroundEvents()],
    [sessions]
  );

  /** Per-curriculum-course progress: scheduled hours vs minimum. */
  const courseProgress = useMemo(() => {
    if (!curriculum) return [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return curriculum.courses.map((c) => {
      const cn = norm(c.name);
      const scheduled = fdleSessions
        .filter((s) => {
          const sn = norm(s.title || s.courseName);
          return sn.includes(cn) || cn.includes(sn);
        })
        .reduce((sum, s) => sum + (s.hours || 0), 0);
      return { ...c, scheduled, delta: scheduled - c.minHours };
    });
  }, [curriculum, fdleSessions]);

  /** Sessions landing on school holidays (the post-clone trap). */
  const holidayConflicts = useMemo(() => {
    const holidayDates = new Map<string, string>();
    for (let y = new Date().getFullYear() - 1; y <= new Date().getFullYear() + 2; y++) {
      for (const h of holidaysForYear(y)) holidayDates.set(h.date.toDateString(), h.name);
    }
    return liveSessions
      .map((s) => ({ session: s, holiday: holidayDates.get(s.start.toDate().toDateString()) }))
      .filter((x): x is { session: WithId<SessionDoc>; holiday: string } => !!x.holiday);
  }, [liveSessions]);

  /** Courses grouped for the open-sign-ups control. */
  const courseGroups = useMemo(() => {
    const map = new Map<string, { scheduled: number; open: number; total: number }>();
    for (const s of liveSessions) {
      if (s.status === 'completed') continue;
      const key = s.title || s.courseName;
      const g = map.get(key) ?? { scheduled: 0, open: 0, total: 0 };
      g.total++;
      if (s.status === 'scheduled') g.scheduled++;
      if (s.status === 'open' || s.status === 'fully_staffed') g.open++;
      map.set(key, g);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
      hours: hoursBetween(start, end),
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
      for (const h of holidaysForYear(y)) holidaySet.add(h.date.toDateString());
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

      <div className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          initialDate={academy.startDate.toDate() > new Date() ? academy.startDate.toDate() : new Date()}
          firstDay={1}
          weekends={showWeekends}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' }}
          events={events}
          eventContent={renderEventContent}
          editable
          eventDrop={onEventChange}
          eventResize={onEventChange}
          eventClick={(arg) => {
            const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
            if (s) setDetailSession(s);
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
            Drag to move, drag edges to resize — changes save immediately. ▲ marks high-liability sessions.
          </p>
          <label className="flex items-center gap-2 text-xs text-watch-700">
            <input type="checkbox" checked={showWeekends} onChange={(e) => setShowWeekends(e.target.checked)} />
            Show weekends
          </label>
        </div>
      </div>

      {formOpen && <SessionFormModal academy={academy} session={formSession} onClose={() => setFormOpen(false)} />}
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
  const [coordinatorIds, setCoordinatorIds] = useState<string[]>(academy.coordinatorIds);
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
      coordinatorIds,
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
        <Field label="Coordinators">
          <Select
            multiple
            size={4}
            value={coordinatorIds}
            onChange={(e) => setCoordinatorIds([...e.target.selectedOptions].map((o) => o.value))}
          >
            {coordinators.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
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
