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
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../lib/rbac';
import { hoursBetween, tsFromDate, fmtDate } from '../../lib/time';
import { holidaysForYear, holidayBackgroundEvents, observedHolidayDatesInRange, HOLIDAY_PAY_HOURS } from '../../lib/holidays';
import type { AcademyDoc, CoursePublishTarget, CurriculumDoc, QualificationKey, RosterMemberDoc, SessionDoc, UserDoc } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { SessionFormModal } from './SessionFormModal';
import { RecurringGeneratorModal } from './RecurringGeneratorModal';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { sessionToEvent, renderEventContent } from './sessionEvents';
import { ACADEMY_COLORS } from '../../lib/academyColors';
import { groupPayPeriods, payPeriodStart, DEFAULT_PAY_PERIOD_TARGET, q } from '../../lib/payPeriods';
import { useGlobalSettings } from '../../app/providers';
import { logAudit } from '../sessions/audit';

const academyApproval = httpsCallable<
  { academyId: string; action: 'submit' | 'approve' | 'request_changes'; sergeantId?: string; note?: string },
  { ok: boolean; state: string }
>(functions, 'academyApproval');

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
  // Roster headcount (real academies only) — active cadets, withdrawals removed.
  const { data: rosterMembers } = useCollection<RosterMemberDoc>(
    academy && !academy.isTemplate ? `academies/${academyId}/roster` : null,
    [],
    [academyId, academy?.isTemplate]
  );
  const classSize = rosterMembers.filter((m) => m.status !== 'withdrawn' && !m.blockTaker).length;

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
  const [search, setSearch] = useState('');
  const [detailSession, setDetailSession] = useState<WithId<SessionDoc> | null>(null);
  const [signupModal, setSignupModal] = useState<{
    label: string;
    mode: 'open' | 'announce';
    group: { open: number; scheduled: number; total: number };
  } | null>(null);

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
  // Round to the quarter-hour so float accumulation never shows e.g. 769.99999.
  const scheduledHours = useMemo(() => q(fdleSessions.reduce((sum, s) => sum + (s.hours || 0), 0)), [fdleSessions]);

  // Shade holidays across the academy's own span (start→end year), so a class
  // running into a future year still shows its holidays — not a fixed window.
  const holidayRange = useMemo(() => {
    if (!academy) return undefined;
    return { fromYear: academy.startDate.toDate().getFullYear(), toYear: academy.endDate.toDate().getFullYear() };
  }, [academy]);

  // Free-text search to locate a course (e.g. "defensive tactics") anywhere on
  // the calendar. Matching sessions stay; the rest drop off until cleared.
  const matchedSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((s) =>
      [s.courseName, s.title, s.room, s.notes].filter(Boolean).join(' ').toLowerCase().includes(term)
    );
  }, [sessions, search]);

  const events = useMemo(
    () => [...matchedSessions.map((s) => sessionToEvent(s, { editable: true })), ...holidayBackgroundEvents(disabledHolidays, observedHolidays, holidayRange)],
    [matchedSessions, disabledHolidays, observedHolidays, holidayRange]
  );

  // Jump to the earliest match so a hit far out on the calendar is found, not just filtered.
  React.useEffect(() => {
    if (!search.trim() || matchedSessions.length === 0) return;
    const earliest = matchedSessions.reduce((a, b) => (a.start.toMillis() <= b.start.toMillis() ? a : b));
    calRef.current?.getApi().gotoDate(earliest.start.toDate());
  }, [search, matchedSessions]);

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
    // High-liability flag comes from the discipline's own curriculum block.
    return curriculum.courses.map((c) => {
      const scheduled = q(hoursByCourse.get(norm(c.name)) ?? 0);
      return { ...c, scheduled, delta: q(scheduled - c.minHours), highLiability: !!c.highLiability };
    });
  }, [curriculum, fdleSessions]);

  /** Sessions landing on school holidays (the post-clone trap). */
  const holidayConflicts = useMemo(() => {
    const holidayDates = new Map<string, string>();
    // Cover the academy's own span (clamped to a sane minimum) so a session in
    // any year — including future ones — is still checked against holidays.
    const now = new Date().getFullYear();
    const fromYear = Math.min(academy?.startDate.toDate().getFullYear() ?? now, now) - 1;
    const toYear = Math.max(academy?.endDate.toDate().getFullYear() ?? now, now) + 1;
    for (let y = fromYear; y <= toYear; y++) {
      for (const h of holidaysForYear(y, disabledHolidays)) holidayDates.set(h.date.toDateString(), h.name);
    }
    return liveSessions
      // Agency/custom blocks (PSO assignments, etc.) on a holiday are intentional
      // — only FDLE academy sessions on a closed day are a real conflict.
      .filter((s) => s.countsTowardFdle !== false)
      .map((s) => ({ session: s, holiday: holidayDates.get(s.start.toDate().toDateString()) }))
      .filter((x): x is { session: WithId<SessionDoc>; holiday: string } => !!x.holiday);
  }, [liveSessions, disabledHolidays, academy]);

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

  const hoursGap = q(academy.targetTotalHours - scheduledHours);
  const published = academy.status !== 'draft' && academy.status !== 'archived';
  // Real classes can only be published after the captain's approval; templates skip it.
  const approvalState = academy.approval?.state ?? 'not_submitted';
  const canPublishNow = academy.isTemplate || approvalState === 'approved';

  async function onEventChange(arg: EventDropArg | EventResizeDoneArg) {
    const s = arg.event.extendedProps.session as WithId<SessionDoc> | undefined;
    if (!s) return;
    const start = arg.event.start!;
    const end = arg.event.end ?? new Date(start.getTime() + (s.end.toMillis() - s.start.toMillis()));
    await updateDoc(doc(db, 'sessions', s.id), {
      start: tsFromDate(start),
      end: tsFromDate(end),
      // Preserve the lunch carve-out — instructional hours exclude it (unless lunch counts).
      hours: Math.max(0, hoursBetween(start, end) - (s.lunchCountsTowardHours ? 0 : (s.lunchMinutes ?? 0) / 60)),
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

  /** Open (or close) sign-ups for every session of a course. Returns the count changed. */
  async function setCourseSignups(courseLabel: string, open: boolean): Promise<number> {
    if (!firebaseUser) return 0;
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
    await logAudit(
      firebaseUser.uid,
      open ? 'course.open_signups' : 'course.close_signups',
      'academy',
      academyId!,
      `${open ? 'Opened' : 'Closed'} sign-ups for ${n} "${courseLabel}" sessions`
    );
    return n;
  }

  /**
   * Queue the "sign-ups open" announcement for a course. Gjallarhorn emails the
   * chosen target (everyone eligible / a qualification / specific people). The
   * course is visible to all eligible instructors regardless — this only drives
   * the email blast, so a coordinator can soft-launch then notify the rest later.
   */
  async function announceCourse(courseLabel: string, target: CoursePublishTarget, sessionCount: number) {
    if (!firebaseUser || sessionCount <= 0) return;
    await addDoc(collection(db, 'coursePublishEvents'), {
      academyId: academyId!,
      courseLabel,
      sessionCount,
      target,
      requestedBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
    });
    await logAudit(firebaseUser.uid, 'course.announce', 'academy', academyId!, `Announced "${courseLabel}" sign-ups (${target.mode})`);
  }

  /** Confirm handler for the Open-sign-ups modal. */
  async function confirmCourseSignups(emailTarget: CoursePublishTarget | null) {
    if (!signupModal) return;
    const { label, group, mode } = signupModal;
    if (mode === 'open') {
      const opened = await setCourseSignups(label, true);
      if (emailTarget) await announceCourse(label, emailTarget, group.open + opened);
    } else if (emailTarget) {
      await announceCourse(label, emailTarget, group.open);
    }
    setSignupModal(null);
  }

  /** Jump the calendar to where a conflicted session sits so it can be moved in
   *  place — replaces the old auto "shift to next school day" (which moved
   *  sessions blindly, often onto an unintended day). */
  function goToSessionOnCalendar(s: WithId<SessionDoc>) {
    const api = calRef.current?.getApi();
    if (!api) return;
    api.changeView('timeGridWeek', s.start.toDate());
    document.getElementById('builder-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <PageHeader
        back
        kicker="CADRE — Schedule Builder"
        title={academy.shortName ? `${academy.shortName} — ${academy.name}` : academy.name}
        actions={
          <>
            {!academy.isTemplate && (
              <Link
                to={`/cadre/academies/${academy.id}/roster`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500"
              >
                Roster{classSize > 0 ? ` (${classSize})` : ''}
              </Link>
            )}
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
        {!academy.isTemplate && (
          <Link to={`/cadre/academies/${academy.id}/roster`} className="rounded-md px-2 py-1 hover:bg-watch-50" title="View roster">
            <div className="text-xs uppercase tracking-wider text-watch-500">Class size</div>
            <div className="text-2xl font-bold text-watch-900">{classSize}</div>
          </Link>
        )}
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
          {academy.isTemplate ? (
            // Templates never publish to a calendar — they're only used to create academies.
            <Badge tone="navy">Template</Badge>
          ) : (
            <>
              <Badge tone={published ? 'green' : 'slate'}>{academy.status.replace('_', ' ')}</Badge>
              <Button
                onClick={togglePublish}
                disabled={!published && !canPublishNow}
                title={!published && !canPublishNow ? 'Captain approval is required before publishing' : undefined}
              >
                {published ? 'Unpublish' : 'Publish to calendar'}
              </Button>
            </>
          )}
          <Link to={`/reports/print/${academy.id}`} target="_blank" rel="noopener" className="text-sm text-bifrost-700 hover:underline">
            Print view ↗
          </Link>
        </div>
      </div>

      {/* Chain-of-command approval before publishing (real classes only) */}
      {!academy.isTemplate && <ApprovalPanel academy={academy} />}

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
                <Button onClick={() => goToSessionOnCalendar(s)}>Show on calendar</Button>
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
              {/* High-liability courses first, then a bold black divider, then the rest. */}
              {courseProgress.filter((c) => c.highLiability).map((c) => (
                <CourseCoverageRow key={c.name} c={c} />
              ))}
              {courseProgress.some((c) => c.highLiability) && courseProgress.some((c) => !c.highLiability) && (
                <li className="my-2 h-[3px] rounded bg-black" aria-hidden />
              )}
              {courseProgress.filter((c) => !c.highLiability).map((c) => (
                <CourseCoverageRow key={c.name} c={c} />
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
          {academy.isTemplate ? (
            <p className="text-sm text-slate-500">
              This is a <strong>template</strong> — it never publishes or opens sign-ups. Use it to create an
              academy (Academies → Use template), then publish and open sign-ups there.
            </p>
          ) : !published ? (
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
                      <Button onClick={() => setSignupModal({ label, mode: 'open', group: g })}>Open sign-ups</Button>
                    )}
                    {g.open > 0 && (
                      <>
                        <Button variant="ghost" onClick={() => setSignupModal({ label, mode: 'announce', group: g })}>
                          Notify…
                        </Button>
                        <Button variant="ghost" onClick={() => setCourseSignups(label, false)}>
                          Close
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div id="builder-calendar" className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this academy’s sessions — e.g. “defensive tactics”…"
            aria-label="Search sessions"
            className="flex-1"
          />
          {search.trim() && (
            <span className="shrink-0 text-xs text-slate-500">
              {matchedSessions.length} match{matchedSessions.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="twoWeek"
          initialDate={academy.startDate.toDate() > new Date() ? academy.startDate.toDate() : new Date()}
          firstDay={1}
          weekends={showWeekends}
          views={{ twoWeek: { type: 'timeGrid', duration: { weeks: 2 }, buttonText: '2 weeks' } }}
          customButtons={{ hoursLabel: { text: ' ', click: () => {} } }}
          datesSet={(arg) => {
            // The 2-week view represents one pay period (bi-weekly, anchored to
            // Jan 5 2026). FullCalendar only aligns a multi-week view to *a*
            // Monday, so "today" / switching views can start it on a week-2
            // Monday — flipping the fortnight (even week left, odd week right)
            // and making the "Pay period: x / 85" label sum the wrong 14 days.
            // Snap back to the pay-period boundary so week 1 is always on the left.
            if (arg.view.type === 'twoWeek') {
              const aligned = payPeriodStart(arg.start);
              if (aligned.getTime() !== arg.start.getTime()) {
                calRef.current?.getApi().gotoDate(aligned);
                return; // the re-navigation fires datesSet again, now aligned
              }
            }
            setViewRange({ start: arg.start, end: arg.end, type: arg.view.type });
          }}
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
          slotMaxTime="23:00:00"
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
      {signupModal && (
        <OpenSignupsModal
          courseLabel={signupModal.label}
          mode={signupModal.mode}
          sessionCount={signupModal.mode === 'open' ? signupModal.group.scheduled : signupModal.group.open}
          onConfirm={confirmCourseSignups}
          onClose={() => setSignupModal(null)}
        />
      )}
    </div>
  );
}

/**
 * Confirmation for opening (or re-announcing) a course's sign-ups, with control
 * over who gets the email. The course becomes visible to every eligible
 * instructor either way — the target only decides who gets pushed an email, so
 * a coordinator can soft-launch to a few people, then notify the rest later.
 */
function OpenSignupsModal({
  courseLabel,
  mode,
  sessionCount,
  onConfirm,
  onClose,
}: {
  courseLabel: string;
  mode: 'open' | 'announce';
  sessionCount: number;
  onConfirm: (target: CoursePublishTarget | null) => Promise<void>;
  onClose: () => void;
}) {
  const { data: users } = useCollection<UserDoc>('users', [where('status', '==', 'active')]);
  type Choice = 'all' | 'qualification' | 'users' | 'none';
  const [choice, setChoice] = useState<Choice>('all');
  const [qualKey, setQualKey] = useState<QualificationKey>('handgun');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const instructors = users
    .filter((u) => u.role === 'instructor' || u.qualifications.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const valid = choice !== 'users' || selectedUids.length > 0;

  async function submit() {
    setBusy(true);
    let target: CoursePublishTarget | null = null;
    if (choice === 'all') target = { mode: 'all' };
    else if (choice === 'qualification') target = { mode: 'qualification', qualificationKey: qualKey };
    else if (choice === 'users') target = { mode: 'users', uids: selectedUids };
    // 'none' → leave target null (open without emailing)
    try {
      await onConfirm(target);
    } finally {
      setBusy(false);
    }
  }

  const toggleUid = (uid: string) =>
    setSelectedUids((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));

  const Radio = ({ value, label, hint }: { value: Choice; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-watch-100 px-3 py-2 hover:bg-watch-50">
      <input type="radio" className="mt-1" checked={choice === value} onChange={() => setChoice(value)} />
      <span>
        <span className="block text-sm font-medium text-watch-900">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Modal open onClose={onClose} title={mode === 'open' ? `Open sign-ups — ${courseLabel}` : `Notify instructors — ${courseLabel}`}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          {mode === 'open'
            ? `This opens ${sessionCount} ${courseLabel} session${sessionCount === 1 ? '' : 's'} for instructor sign-up.`
            : `Send another sign-up announcement for ${courseLabel}. Sessions stay open.`}{' '}
          Choose who gets an email:
        </p>

        <div className="space-y-2">
          <Radio value="all" label="Everyone eligible for this course" hint="All active instructors who qualify for an open slot." />
          <Radio value="qualification" label="Only a specific qualification" hint="e.g. open Firearms to Handgun instructors only." />
          {choice === 'qualification' && (
            <div className="pl-7">
              <Select value={qualKey} onChange={(e) => setQualKey(e.target.value as QualificationKey)}>
                {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).sort((a, b) => QUALIFICATION_LABELS[a].localeCompare(QUALIFICATION_LABELS[b])).map((k) => (
                  <option key={k} value={k}>
                    {QUALIFICATION_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Radio value="users" label="Only specific people" hint="Soft-launch to a hand-picked few; notify the rest later." />
          {choice === 'users' && (
            <div className="ml-7 max-h-48 space-y-1 overflow-y-auto rounded-md border border-watch-100 p-2">
              {instructors.length === 0 && <p className="px-1 text-xs text-slate-400">No instructors yet.</p>}
              {instructors.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-watch-50">
                  <input type="checkbox" checked={selectedUids.includes(u.id)} onChange={() => toggleUid(u.id)} />
                  <span className="text-watch-800">{u.displayName}</span>
                  <span className="text-xs text-slate-400">
                    {u.verifiedQualKeys?.length ? u.verifiedQualKeys.join(', ') : 'no verified quals'}
                  </span>
                </label>
              ))}
            </div>
          )}
          {mode === 'open' && <Radio value="none" label="Open without emailing anyone" hint="Sessions become open; send announcements later." />}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !valid} onClick={submit}>
            {busy ? 'Working…' : mode === 'open' ? 'Open sign-ups' : 'Send announcement'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One row of the curriculum-coverage list. */
function CourseCoverageRow({
  c,
}: {
  c: { cjk?: string; name: string; minHours: number; scheduled: number; delta: number; highLiability?: boolean; instructorRatio?: number };
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate text-watch-800">
        {c.highLiability && <span className="mr-1 text-status-critical" title="High-liability">▲</span>}
        {c.cjk && <span className="mr-1 font-mono text-xs text-slate-400">{c.cjk}</span>}
        {c.name}
        {c.instructorRatio ? (
          <span className="ml-1 text-xs text-slate-400" title="FDLE ratio: students per instructor">· 1:{c.instructorRatio}</span>
        ) : null}
      </span>
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
    const opts = [...curricula].sort((a, b) => a.label.localeCompare(b.label)).map((c) => ({ id: c.id, label: c.label }));
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
            <Input type="number" min={1} step="any" value={targetHours} onChange={(e) => setTargetHours(Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary coordinator" hint="Default owner for assigned blocks">
            <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">— none —</option>
              {[...coordinators].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Secondary coordinator">
            <Select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              <option value="">— none —</option>
              {coordinators.filter((u) => u.id !== primary).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((u) => (
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

/**
 * Chain-of-command sign-off before a class can be published:
 * Coordinator submits → Sergeant → Lieutenant → Captain → approved. Any approver
 * can send it back with "Request changes." Actions run through the academyApproval
 * callable, which enforces who can act at each step.
 */
const APPROVAL_STEPS: { state: string; label: string }[] = [
  { state: 'pending_sergeant', label: 'Sergeant' },
  { state: 'pending_lieutenant', label: 'Lieutenant' },
  { state: 'pending_captain', label: 'Captain' },
];

function ApprovalPanel({ academy }: { academy: WithId<AcademyDoc> }) {
  const { firebaseUser, role } = useAuth();
  const uid = firebaseUser?.uid;
  const ap = academy.approval;
  const state = ap?.state ?? 'not_submitted';
  const { data: sergeants } = useCollection<UserDoc>('users', [where('role', '==', 'sergeant'), where('status', '==', 'active')]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const canSubmit = can.buildSchedules(role) && (state === 'not_submitted' || state === 'changes_requested');
  const isActiveApprover =
    (state === 'pending_sergeant' && uid === ap?.sergeantId) ||
    (state === 'pending_lieutenant' && role === 'lieutenant') ||
    (state === 'pending_captain' && role === 'director');

  const order = APPROVAL_STEPS.map((s) => s.state);
  const curIdx = state === 'approved' ? order.length : order.indexOf(state);
  const sergeantName = sergeants.find((s) => s.id === ap?.sergeantId)?.displayName ?? 'sergeant';

  async function run(action: 'submit' | 'approve' | 'request_changes', extra?: { sergeantId?: string; note?: string }) {
    setBusy(true);
    setErr(null);
    try {
      await academyApproval({ academyId: academy.id, action, ...extra });
      setNoteOpen(false);
      setNote('');
      setSubmitOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^FirebaseError: /, '') : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Publishing approval</h2>
        {state === 'approved' && <Badge tone="green">Approved — ready to publish</Badge>}
        {state === 'not_submitted' && <Badge tone="slate">Not submitted</Badge>}
        {state === 'changes_requested' && <Badge tone="amber">Changes requested</Badge>}
        {state.startsWith('pending') && <Badge tone="navy">In review</Badge>}
      </div>

      {/* Chain progress */}
      <div className="mb-3 flex items-center gap-1 text-xs">
        {APPROVAL_STEPS.map((s, i) => {
          const done = curIdx > i;
          const active = curIdx === i;
          return (
            <React.Fragment key={s.state}>
              <span
                className={`rounded-full px-2.5 py-1 font-medium ring-1 ${
                  done
                    ? 'bg-green-50 text-green-700 ring-green-200'
                    : active
                      ? 'bg-bifrost-50 text-bifrost-700 ring-bifrost-300'
                      : 'bg-watch-50 text-slate-400 ring-watch-100'
                }`}
              >
                {done ? '✓ ' : ''}
                {s.label}
                {s.state === 'pending_sergeant' && ap?.sergeantId ? ` (${sergeantName})` : ''}
              </span>
              {i < APPROVAL_STEPS.length - 1 && <span className="text-slate-300">→</span>}
            </React.Fragment>
          );
        })}
        <span className={`ml-1 rounded-full px-2.5 py-1 font-medium ring-1 ${state === 'approved' ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-watch-50 text-slate-400 ring-watch-100'}`}>
          {state === 'approved' ? '✓ ' : ''}Publish
        </span>
      </div>

      {state === 'changes_requested' && ap?.changesNote && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Changes requested:</strong> {ap.changesNote}
        </p>
      )}
      {state === 'not_submitted' && (
        <p className="mb-3 text-sm text-slate-500">Finish the schedule, then submit it up the chain of command for sign-off before publishing.</p>
      )}

      {err && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {canSubmit && (
          <Button variant="primary" disabled={busy} onClick={() => setSubmitOpen(true)}>
            {state === 'changes_requested' ? 'Resubmit for approval' : 'Submit for approval'}
          </Button>
        )}
        {isActiveApprover && !noteOpen && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => run('approve')}>
              Approve
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setNoteOpen(true)}>
              Request changes
            </Button>
          </>
        )}
        {isActiveApprover && noteOpen && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <textarea
              className="min-w-[16rem] flex-1 rounded-md border border-watch-200 px-2 py-1 text-sm"
              rows={2}
              placeholder="What needs to change?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button variant="danger" disabled={busy || !note.trim()} onClick={() => run('request_changes', { note: note.trim() })}>
              Send back
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setNoteOpen(false); setNote(''); }}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {submitOpen && (
        <Modal open onClose={() => setSubmitOpen(false)} title="Submit for approval">
          <SubmitForApproval sergeants={sergeants} busy={busy} onSubmit={(sid) => run('submit', { sergeantId: sid })} onCancel={() => setSubmitOpen(false)} />
        </Modal>
      )}
    </section>
  );
}

function SubmitForApproval({
  sergeants,
  busy,
  onSubmit,
  onCancel,
}: {
  sergeants: WithId<UserDoc>[];
  busy: boolean;
  onSubmit: (sergeantId: string) => void;
  onCancel: () => void;
}) {
  const [sid, setSid] = useState(sergeants[0]?.id ?? '');
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        This routes the class up the chain of command — <strong>Sergeant → Lieutenant → Captain</strong>. The lieutenant
        and captain are set automatically; choose which sergeant to send it to first.
      </p>
      {sergeants.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">No active sergeants exist yet — add one before submitting.</p>
      ) : (
        <Field label="Send to sergeant">
          <Select value={sid} onChange={(e) => setSid(e.target.value)}>
            {[...sergeants].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || !sid} onClick={() => onSubmit(sid)}>
          Submit
        </Button>
      </div>
    </div>
  );
}
