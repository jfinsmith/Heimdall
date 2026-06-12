/**
 * CADRE — Calendar (all users). Month/week/day/list views with filters:
 * academy, course, discipline, room, staffing status, "slots I'm qualified
 * for". Instructors only see published academies (also enforced by rules).
 */
import React, { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../lib/rbac';
import type { AcademyDoc, SessionDoc } from '../../types';
import { DISCIPLINE_LABELS, unfilledSlots } from '../../types';
import { Field, PageHeader, Select } from '../../components/ui';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { sessionToEvent, STATUS_COLORS } from './sessionEvents';

type StaffingFilter = 'all' | 'open' | 'understaffed' | 'fully_staffed';

export function CalendarPage() {
  const { profile, role } = useAuth();
  const staff = can.viewStaffing(role);

  const { data: academies } = useCollection<AcademyDoc>('academies');
  const { data: sessions } = useCollection<SessionDoc>('sessions');

  const [academyFilter, setAcademyFilter] = useState('all');
  const [disciplineFilter, setDisciplineFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [staffingFilter, setStaffingFilter] = useState<StaffingFilter>('all');
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const visibleAcademies = useMemo(
    () => (staff ? academies : academies.filter((a) => a.status !== 'draft' && a.status !== 'archived')),
    [academies, staff]
  );
  const academyIds = useMemo(() => new Set(visibleAcademies.map((a) => a.id)), [visibleAcademies]);
  const academyById = useMemo(() => new Map(visibleAcademies.map((a) => [a.id, a])), [visibleAcademies]);

  const myQualKeys = useMemo(
    () =>
      new Set(
        (profile?.qualifications ?? [])
          .filter((q) => q.verified && (!q.expires || q.expires.toMillis() > Date.now()))
          .map((q) => q.key)
      ),
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

  const events = useMemo(() => filtered.map((s) => sessionToEvent(s as WithId<SessionDoc>)), [filtered]);

  return (
    <div>
      <PageHeader kicker="CADRE — Coordinated Academy Duty & Roster Engine" title="Calendar" />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Field label="Academy">
          <Select value={academyFilter} onChange={(e) => setAcademyFilter(e.target.value)}>
            <option value="all">All</option>
            {visibleAcademies.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Discipline">
          <Select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)}>
            <option value="all">All</option>
            {(['law_enforcement', 'corrections', 'cross_over'] as const).map((d) => (
              <option key={d} value={d}>{DISCIPLINE_LABELS[d]}</option>
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
        <label className="flex items-end gap-2 pb-2 text-sm text-watch-800">
          <input type="checkbox" checked={qualifiedOnly} onChange={(e) => setQualifiedOnly(e.target.checked)} />
          Slots I qualify for
        </label>
      </div>

      <div className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          events={events}
          eventClick={(arg) => setDetailId(arg.event.id)}
          height="auto"
          nowIndicator
        />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <Legend color={STATUS_COLORS.staffed} label="Fully staffed" />
          <Legend color={STATUS_COLORS.open} label="Understaffed / open" />
          <Legend color={STATUS_COLORS.critical} label="Cancelled / critical" />
          <Legend color={STATUS_COLORS.draft} label="Draft" />
          <span>▲ = high-liability</span>
        </div>
      </div>

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
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
