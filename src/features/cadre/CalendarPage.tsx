/**
 * CADRE — Calendar (all users). Month/week/day/list with filters. Concurrent
 * cohorts are distinguished by per-academy color; weekends are collapsed by
 * default (Monday-first, so Sat/Sun sit on the right when shown). Staff get an
 * inline Edit button from the session detail.
 */
import React, { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useGlobalSettings } from '../../app/providers';
import { can } from '../../lib/rbac';
import type { AcademyDoc, CurriculumDoc, SessionDoc } from '../../types';
import { unfilledSlots } from '../../types';
import { academyColorFor } from '../../lib/academyColors';
import { Field, PageHeader, Select } from '../../components/ui';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { SessionFormModal } from './SessionFormModal';
import { sessionToEvent, renderEventContent } from './sessionEvents';
import { holidayBackgroundEvents } from '../../lib/holidays';

type StaffingFilter = 'all' | 'open' | 'understaffed' | 'fully_staffed';

export function CalendarPage() {
  const { profile, role } = useAuth();
  const settings = useGlobalSettings();
  const disabledHolidays = useMemo(() => new Set(settings?.disabledHolidays ?? []), [settings]);
  const observedHolidays = useMemo(() => new Set(settings?.observedHolidays ?? []), [settings]);
  const staff = can.viewStaffing(role);
  const canEdit = can.buildSchedules(role);

  const { data: academies } = useCollection<AcademyDoc>('academies');
  const { data: curricula } = useCollection<CurriculumDoc>('curricula');
  const { data: sessions } = useCollection<SessionDoc>('sessions');

  const [academyFilter, setAcademyFilter] = useState('all');
  const [disciplineFilter, setDisciplineFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [staffingFilter, setStaffingFilter] = useState<StaffingFilter>('all');
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const [showWeekends, setShowWeekends] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editSession, setEditSession] = useState<WithId<SessionDoc> | null>(null);

  const visibleAcademies = useMemo(
    () =>
      academies
        .filter((a) => !a.isTemplate) // templates never appear on calendars
        .filter((a) => staff || (a.status !== 'draft' && a.status !== 'archived')),
    [academies, staff]
  );
  const academyIds = useMemo(() => new Set(visibleAcademies.map((a) => a.id)), [visibleAcademies]);
  const academyById = useMemo(() => new Map(visibleAcademies.map((a) => [a.id, a])), [visibleAcademies]);

  const myQualKeys = useMemo(
    () => new Set((profile?.qualifications ?? []).filter((q) => q.verified).map((q) => q.key)),
    [profile]
  );

  const courses = useMemo(() => [...new Set(sessions.map((s) => s.courseName))].sort(), [sessions]);
  const rooms = useMemo(() => [...new Set(sessions.map((s) => s.room).filter(Boolean))].sort(), [sessions]);

  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        if (!academyIds.has(s.academyId)) return false;
        if (!staff && s.status === 'draft') return false;
        if (academyFilter !== 'all' && s.academyId !== academyFilter) return false;
        if (courseFilter !== 'all' && s.courseName !== courseFilter) return false;
        if (roomFilter !== 'all' && s.room !== roomFilter) return false;
        if (disciplineFilter !== 'all' && academyById.get(s.academyId)?.discipline !== disciplineFilter) return false;
        if (staffingFilter !== 'all') {
          const under = unfilledSlots(s).length > 0;
          if (staffingFilter === 'fully_staffed' && (under || s.status === 'cancelled')) return false;
          if (staffingFilter === 'understaffed' && !under) return false;
          if (staffingFilter === 'open' && s.status !== 'open') return false;
        }
        if (qualifiedOnly) {
          const fillable = s.roleSlots.some(
            (slot) =>
              slot.filledBy.length < slot.count &&
              (!slot.requiredQualificationKey || myQualKeys.has(slot.requiredQualificationKey))
          );
          if (!fillable) return false;
        }
        return true;
      }),
    [sessions, academyIds, academyById, staff, academyFilter, courseFilter, roomFilter, disciplineFilter, staffingFilter, qualifiedOnly, myQualKeys]
  );

  const events = useMemo(
    () => [
      ...filtered.map((s) => {
        const academy = academyById.get(s.academyId);
        return sessionToEvent(s as WithId<SessionDoc>, {
          academyPrefix: academy?.shortName || academy?.name,
          academyColor: academyColorFor(academy),
        });
      }),
      ...holidayBackgroundEvents(disabledHolidays, observedHolidays),
    ],
    [filtered, academyById, disabledHolidays, observedHolidays]
  );

  // Color legend for whichever academies are currently shown.
  const legendAcademies = useMemo(
    () => visibleAcademies.filter((a) => academyFilter === 'all' || a.id === academyFilter),
    [visibleAcademies, academyFilter]
  );

  function openEdit(s: WithId<SessionDoc>) {
    setDetailId(null);
    setEditSession(s);
  }
  const editAcademy = editSession ? academyById.get(editSession.academyId) : null;

  return (
    <div>
      <PageHeader kicker="CADRE — Coordinated Academy Duty & Roster Engine" title="Calendar" />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Field label="Academy">
          <Select value={academyFilter} onChange={(e) => setAcademyFilter(e.target.value)}>
            <option value="all">All</option>
            {visibleAcademies.map((a) => (
              <option key={a.id} value={a.id}>{a.shortName || a.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Discipline">
          <Select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)}>
            <option value="all">All</option>
            {curricula.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Course">
          <Select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
            <option value="all">All</option>
            {courses.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Room">
          <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="all">All</option>
            {rooms.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Staffing">
          <Select value={staffingFilter} onChange={(e) => setStaffingFilter(e.target.value as StaffingFilter)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="understaffed">Understaffed</option>
            <option value="fully_staffed">Fully staffed</option>
          </Select>
        </Field>
        <div className="flex flex-col justify-end gap-1 pb-1 text-sm text-watch-800">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={qualifiedOnly} onChange={(e) => setQualifiedOnly(e.target.checked)} />
            Slots I qualify for
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showWeekends} onChange={(e) => setShowWeekends(e.target.checked)} />
            Show weekends
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          firstDay={1}
          weekends={showWeekends}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' }}
          events={events}
          eventContent={renderEventContent}
          // Group overlapping events by cohort, then by time, so concurrent
          // academies cluster instead of interleaving.
          eventOrder={'academyPrefix,start' as unknown as string}
          eventClick={(arg) => {
            if (arg.event.extendedProps.session) setDetailId(arg.event.id);
          }}
          slotMinTime="05:00:00"
          slotMaxTime="22:00:00"
          slotEventOverlap={false}
          expandRows
          dayMaxEvents={4}
          height="auto"
          listDayFormat={{ weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }}
          listDaySideFormat={false}
          nowIndicator
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          {legendAcademies.map((a) => (
            <Legend key={a.id} color={academyColorFor(a)} label={a.shortName || a.name} />
          ))}
          <span className="text-slate-300">|</span>
          <span>thin border = staffing status</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: '#b91c1c', opacity: 0.3 }} />
            School holiday
          </span>
          <span>▲ = high-liability</span>
        </div>
      </div>

      {detailId && (
        <SessionDetailModal
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={canEdit ? openEdit : undefined}
        />
      )}
      {editSession && editAcademy && (
        <SessionFormModal academy={editAcademy} session={editSession} onClose={() => setEditSession(null)} />
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
