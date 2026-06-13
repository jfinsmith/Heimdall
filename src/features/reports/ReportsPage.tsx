/**
 * Reports & export — CSV exports (schedule, sign-ups, instructor hours),
 * FDLE-style hours summary per academy, links to printable schedules.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';
import { downloadCsv } from '../../lib/csv';
import { fmtDate } from '../../lib/time';
import type { AcademyDoc, AssignmentDoc, SessionDoc, UserDoc } from '../../types';
import { Badge, Button, PageHeader, Select, Field } from '../../components/ui';

export function ReportsPage() {
  const { data: allAcademies } = useCollection<AcademyDoc>('academies');
  const academies = allAcademies.filter((a) => !a.isTemplate);
  const { data: sessions } = useCollection<SessionDoc>('sessions');
  const [academyId, setAcademyId] = useState('');
  const academy = academies.find((a) => a.id === academyId);
  const academySessions = sessions.filter((s) => s.academyId === academyId && s.status !== 'cancelled');
  const scheduled = academySessions.reduce((sum, s) => sum + (s.hours || 0), 0);

  async function exportSchedule() {
    downloadCsv(
      `heimdall-schedule-${academy?.name ?? 'all'}`,
      ['Date', 'Start', 'End', 'Course', 'Room', 'Hours', 'Status', 'High liability', 'Slots filled', 'Slots required'],
      (academyId ? academySessions : sessions).map((s) => [
        s.start.toDate().toLocaleDateString(),
        s.start.toDate().toLocaleTimeString(),
        s.end.toDate().toLocaleTimeString(),
        s.title || s.courseName,
        s.room,
        s.hours,
        s.status,
        s.highLiability,
        s.roleSlots.reduce((n, sl) => n + sl.filledBy.length, 0),
        s.roleSlots.reduce((n, sl) => n + sl.count, 0),
      ])
    );
  }

  async function exportSignups() {
    const rows: (string | number)[][] = [];
    const targets = academyId ? academySessions : sessions;
    for (const s of targets) {
      const snap = await getDocs(collection(db, 'sessions', s.id, 'signups'));
      snap.forEach((d) => {
        const su = d.data();
        rows.push([
          s.start.toDate().toLocaleDateString(),
          s.title || s.courseName,
          su.displayName,
          su.role,
          su.status,
        ]);
      });
    }
    downloadCsv(`heimdall-signups-${academy?.name ?? 'all'}`, ['Date', 'Session', 'Instructor', 'Role', 'Status'], rows);
  }

  async function exportInstructorHours() {
    const snap = await getDocs(query(collection(db, 'assignments'), where('status', '==', 'confirmed')));
    const usersSnap = await getDocs(collection(db, 'users'));
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
      <PageHeader back kicker="Reports" title="Reports & Export" />

      <Field label="Academy (blank = all)" className="mb-6 max-w-sm">
        <Select value={academyId} onChange={(e) => setAcademyId(e.target.value)}>
          <option value="">All academies</option>
          {academies.map((a) => (
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
              <dd className="font-medium text-watch-900">{scheduled}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Target</dt>
              <dd className="font-medium text-watch-900">
                {academy.targetTotalHours}{' '}
                {scheduled >= academy.targetTotalHours ? (
                  <Badge tone="green">met</Badge>
                ) : (
                  <Badge tone="amber">{academy.targetTotalHours - scheduled} short</Badge>
                )}
              </dd>
            </div>
          </dl>
          <Link to={`/reports/print/${academy.id}`} className="mt-3 inline-block text-sm text-bifrost-700 hover:underline">
            Open printable schedule →
          </Link>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={exportSchedule}>
          Export schedule CSV
        </Button>
        <Button onClick={exportSignups}>Export sign-ups CSV</Button>
        <Button onClick={exportInstructorHours}>Export instructor hours CSV</Button>
      </div>
    </div>
  );
}
