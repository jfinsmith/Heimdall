/**
 * Reports & export — CSV exports (schedule, sign-ups, instructor hours),
 * FDLE-style hours summary per academy, links to printable schedules.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { downloadCsv } from '../../lib/csv';
import { fmtDate } from '../../lib/time';
import type { AcademyDoc, AssignmentDoc, SessionDoc, UserDoc } from '../../types';
import { Badge, Button, PageHeader, Select, Field } from '../../components/ui';
import { friendlyError } from '../../lib/callableError';

type ExportKind = 'schedule' | 'signups' | 'hours';
const byStart = (a: SessionDoc, b: SessionDoc) => a.start.toMillis() - b.start.toMillis();

export function ReportsPage() {
  const { orgId } = useAuth();
  const { data: allAcademies, loading: academiesLoading } = useCollection<AcademyDoc>('academies');
  const academies = allAcademies.filter((a) => !a.isTemplate);
  const [academyId, setAcademyId] = useState('');
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Schedule TEMPLATES hold placeholder sessions, not real classes — they belong
  // in no export.
  const templateIds = new Set(allAcademies.filter((a) => a.isTemplate).map((a) => a.id));
  const academyName = new Map(allAcademies.map((a) => [a.id, a.shortName || a.name]));
  // Live ONLY for a selected academy (it feeds the hours summary). With no
  // academy chosen the page used to hold a live listener on EVERY session in the
  // org just in case an export was clicked; the all-academies exports now read
  // that set once, on demand (allSessions below).
  const { data: sessionsRaw, loading: sessionsLoading } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null,
    [where('academyId', '==', academyId)],
    [academyId]
  );
  const academy = academies.find((a) => a.id === academyId);
  const academySessions = sessionsRaw.filter((s) => s.academyId === academyId && s.status !== 'cancelled');
  // FDLE hours = the same tally as the builder: agency blocks flagged "does not
  // count toward FDLE hours" (PSO assignments, formation…) are excluded, or the
  // summary reads "met" while the program is actually short.
  const scheduled = academySessions.filter((s) => s.countsTowardFdle !== false).reduce((sum, s) => sum + (s.hours || 0), 0);

  /** Every non-template session in the org — one read, when an all-academies
   *  export is clicked. Tenant-scoped: the orgId filter is mandatory. */
  async function allSessions(org: string): Promise<WithId<SessionDoc>[]> {
    const snap = await getDocs(query(collection(db, 'sessions'), where('orgId', '==', org)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })).filter((s) => !templateIds.has(s.academyId));
  }
  /** What an export covers, in time order (the listener returns document-id
   *  order, which made the CSV rows come out shuffled). */
  async function exportTargets(org: string): Promise<WithId<SessionDoc>[]> {
    return [...(academyId ? academySessions : await allSessions(org))].sort(byStart);
  }

  /** Run one export: one at a time, with a visible busy state and a visible
   *  failure — these used to fail silently (or do nothing at all without an org). */
  async function run(kind: ExportKind, job: (org: string) => Promise<void>) {
    if (busy) return;
    if (!orgId) { setError('Your account is still loading its organization — reload and try again.'); return; }
    setBusy(kind);
    setError(null);
    try {
      await job(orgId);
    } catch (err) {
      setError(friendlyError(err, 'The export failed — try again in a moment.'));
    } finally {
      setBusy(null);
    }
  }

  async function exportSchedule(org: string) {
    const targets = await exportTargets(org);
    downloadCsv(
      `heimdall-schedule-${academy?.name ?? 'all'}`,
      // "Academy" is LAST so the existing columns keep their positions — without
      // it the all-academies export couldn't tell one class's rows from another's.
      ['Date', 'Start', 'End', 'Course', 'Room', 'Hours', 'Status', 'High liability', 'Slots filled', 'Slots required', 'Academy'],
      targets.map((s) => [
        s.start.toDate().toLocaleDateString(),
        s.start.toDate().toLocaleTimeString(),
        s.end.toDate().toLocaleTimeString(),
        s.title || s.courseName,
        s.room,
        s.hours,
        s.status,
        s.highLiability,
        (s.roleSlots ?? []).reduce((n, sl) => n + sl.filledBy.length, 0),
        (s.roleSlots ?? []).reduce((n, sl) => n + sl.count, 0),
        academyName.get(s.academyId) ?? '',
      ])
    );
  }

  async function exportSignups(org: string) {
    const rows: (string | number)[][] = [];
    // Lunch placeholders are never staffed — no sign-ups to read.
    const targets = (await exportTargets(org)).filter((s) => s.kind !== 'lunch');
    // One sign-ups read per session is unavoidable (a subcollection each), but
    // they need not run one after another: 20 at a time instead of N round trips.
    const CHUNK = 20;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = targets.slice(i, i + CHUNK);
      // Org-filter the signups subcollection: an unfiltered list is denied whole
      // if any sibling signup is org-less (the list-denial bug).
      const snaps = await Promise.all(
        batch.map((s) => getDocs(query(collection(db, 'sessions', s.id, 'signups'), where('orgId', '==', org))))
      );
      snaps.forEach((snap, j) => {
        const s = batch[j];
        snap.forEach((d) => {
          const su = d.data();
          rows.push([
            s.start.toDate().toLocaleDateString(),
            s.title || s.courseName,
            su.displayName,
            su.role,
            su.status,
            academyName.get(s.academyId) ?? '',
          ]);
        });
      });
    }
    downloadCsv(`heimdall-signups-${academy?.name ?? 'all'}`, ['Date', 'Session', 'Instructor', 'Role', 'Status', 'Academy'], rows);
  }

  async function exportInstructorHours(orgId: string) {
    // Tenant-scoped. NEVER fall back to an unconstrained scan — no orgId means
    // "read nothing", not "read every org" (cross-org leak / list-denial).
    const snap = await getDocs(query(collection(db, 'assignments'), where('status', '==', 'confirmed'), where('orgId', '==', orgId)));
    const usersSnap = await getDocs(query(collection(db, 'users'), where('orgId', '==', orgId)));
    const names = new Map(usersSnap.docs.map((d) => [d.id, (d.data() as UserDoc).displayName]));
    const totals = new Map<string, { sessions: number; hours: number }>();
    snap.forEach((d) => {
      const a = d.data() as AssignmentDoc;
      if (academyId && a.academyId !== academyId) return;
      const cur = totals.get(a.uid) ?? { sessions: 0, hours: 0 };
      cur.sessions += 1;
      cur.hours += (a.end.toMillis() - a.start.toMillis()) / 36e5;
      totals.set(a.uid, cur);
    });
    downloadCsv(
      `heimdall-instructor-hours-${academy?.name ?? 'all'}`,
      ['Instructor', 'Sessions', 'Hours'],
      [...totals.entries()].map(([uid, t]) => [names.get(uid) ?? uid, t.sessions, t.hours.toFixed(1)])
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader kicker="Reports" title="Reports & Export" />

      <Field label="Academy (blank = all)" className="mb-6 max-w-sm">
        <Select value={academyId} onChange={(e) => setAcademyId(e.target.value)}>
          <option value="">All academies</option>
          {[...academies].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>

      {academy && (
        <section className="mb-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">
            FDLE hours summary — {academy.name}
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Program</dt>
              <dd className="font-medium text-watch-900">{academy.fdleProgram}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Dates</dt>
              <dd className="font-medium text-watch-900">
                {fmtDate(academy.startDate)} → {fmtDate(academy.endDate)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Scheduled hours</dt>
              <dd className="font-medium text-watch-900">{sessionsLoading ? '…' : scheduled}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Target</dt>
              <dd className="font-medium text-watch-900">
                {academy.targetTotalHours}{' '}
                {sessionsLoading ? null : scheduled >= academy.targetTotalHours ? (
                  <Badge tone="green">met</Badge>
                ) : (
                  <Badge tone="amber">{academy.targetTotalHours - scheduled} short</Badge>
                )}
              </dd>
            </div>
          </dl>
          <Link to={`/reports/print/${academy.id}`} target="_blank" rel="noopener" className="mt-3 inline-block text-sm text-bifrost-700 hover:underline">
            Open printable schedule ↗
          </Link>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        {/* Disabled while the picked academy's sessions (or the academy list
            that identifies templates) are still loading — an early click
            exported an empty or partial file. */}
        <Button variant="primary" disabled={!!busy || sessionsLoading || academiesLoading} onClick={() => run('schedule', exportSchedule)}>
          {busy === 'schedule' ? 'Exporting…' : 'Export schedule CSV'}
        </Button>
        <Button disabled={!!busy || sessionsLoading || academiesLoading} onClick={() => run('signups', exportSignups)}>
          {busy === 'signups' ? 'Exporting…' : 'Export sign-ups CSV'}
        </Button>
        <Button disabled={!!busy} onClick={() => run('hours', exportInstructorHours)}>
          {busy === 'hours' ? 'Exporting…' : 'Export instructor hours CSV'}
        </Button>
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
