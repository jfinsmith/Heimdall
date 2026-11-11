/**
 * Read-only Staffing page — the ONLY page a Viewer account can open.
 *
 * Everything here comes from the getViewerStaffing callable: a Viewer has no
 * direct database access (firestore.rules: isViewer), and the callable returns
 * names, roles, counts and schedule facts only — never contact details, birth
 * dates or ID numbers. Dates and times arrive already formatted in the
 * academy's time zone, so the page reads the same whatever the viewer's
 * browser clock says. There are no edit controls on purpose; the server
 * refuses every write from a Viewer anyway.
 *
 * Plain semantic tables: the page is meant to be easy to read for a person or
 * an assistant reading the page text.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { friendlyError } from '../../lib/callableError';
import { Badge, Button, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { QUALIFICATION_LABELS, SLOT_ROLE_LABELS, type QualificationKey, type SlotRole } from '../../types';

interface ViewerSlot {
  role: string;
  requiredQualification: string | null;
  needed: number;
  filled: { name: string; awaitingConfirmation: boolean }[];
  open: number;
  waitlist: number;
}
interface ViewerSession {
  id: string;
  academyId: string;
  academy: string;
  date: string;
  day: string;
  start: string;
  end: string;
  course: string;
  room: string;
  location: string;
  hours: number;
  status: string;
  test: boolean;
  staffing: 'cancelled' | 'fully_staffed' | 'understaffed' | 'not_open';
  openSeats: number;
  slots: ViewerSlot[];
  writeIns: { name: string; role: string }[];
}
interface ViewerAcademy {
  id: string;
  name: string;
  shortName: string;
  program: string;
  status: string;
  startDate: string;
  endDate: string;
  coordinators: string[];
  cadets: { enrolled: number; blockTakers: number; graduated: number; separated: number };
  sessionsInRange: number;
  openSeatsInRange: number;
}
interface ViewerStaffing {
  orgName: string;
  generatedAt: string;
  range: { from: string; to: string };
  academies: ViewerAcademy[];
  sessions: ViewerSession[];
  totals: { sessions: number; understaffed: number; fullyStaffed: number; notOpen: number; cancelled: number; openSeats: number };
}

const getViewerStaffing = httpsCallable<{ from?: string; to?: string; academyId?: string }, ViewerStaffing>(
  functions,
  'getViewerStaffing'
);

const roleLabel = (r: string) => SLOT_ROLE_LABELS[r as SlotRole] ?? r;
const qualLabel = (q: string | null) => (q ? QUALIFICATION_LABELS[q as QualificationKey] ?? q : '—');
const ACADEMY_STATUS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  in_progress: 'In progress',
  completed: 'Completed',
};
const STAFFING: Record<ViewerSession['staffing'], { label: string; tone: 'red' | 'green' | 'slate' | 'amber' }> = {
  understaffed: { label: 'Understaffed', tone: 'red' },
  fully_staffed: { label: 'Fully staffed', tone: 'green' },
  not_open: { label: 'Not open for sign-up', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export function ViewerStaffingPage() {
  const { role } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [academyId, setAcademyId] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [data, setData] = useState<ViewerStaffing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (params: { from?: string; to?: string; academyId?: string }) => {
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const res = await getViewerStaffing(params);
      if (ticket !== latest.current) return;
      setData(res.data);
      setFrom(res.data.range.from);
      setTo(res.data.range.to);
    } catch (err) {
      if (ticket === latest.current) setError(friendlyError(err, 'Could not load staffing.'));
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  const sessions = useMemo(
    () => (data?.sessions ?? []).filter((s) => !openOnly || s.openSeats > 0),
    [data, openOnly]
  );
  const byDate = useMemo(() => {
    const groups: { date: string; day: string; items: ViewerSession[] }[] = [];
    for (const s of sessions) {
      const last = groups[groups.length - 1];
      if (last && last.date === s.date) last.items.push(s);
      else groups.push({ date: s.date, day: s.day, items: [s] });
    }
    return groups;
  }, [sessions]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    void load({ from, to, ...(academyId ? { academyId } : {}) });
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader kicker={data?.orgName ?? 'Staffing'} title="Staffing" />
      <p className="text-sm text-slate-600">
        Read-only view{role === 'viewer' ? '' : ' (platform owner preview — this is exactly what a Viewer account sees)'}.
        Times are Eastern.{data ? ` Updated ${data.generatedAt}.` : ''}
      </p>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Field label="Class">
          <Select value={academyId} onChange={(e) => setAcademyId(e.target.value)}>
            <option value="">All classes</option>
            {(data?.academies ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.shortName || a.name}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Only sessions with open slots
        </label>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Loading…' : 'Show'}</Button>
      </form>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}
      {!data && busy && <div className="flex justify-center py-16"><Spinner className="text-bifrost-400" /></div>}

      {data && (
        <>
          <section aria-labelledby="viewer-summary" className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 id="viewer-summary" className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">
              Summary, {data.range.from} to {data.range.to}
            </h2>
            <table className="text-sm">
              <tbody>
                <SummaryRow label="Sessions" value={data.totals.sessions} />
                <SummaryRow label="Understaffed (open for sign-up, slots unfilled)" value={data.totals.understaffed} />
                <SummaryRow label="Not yet open for sign-up, slots unfilled" value={data.totals.notOpen} />
                <SummaryRow label="Fully staffed" value={data.totals.fullyStaffed} />
                <SummaryRow label="Open seats in total" value={data.totals.openSeats} />
                <SummaryRow label="Cancelled" value={data.totals.cancelled} />
              </tbody>
            </table>
          </section>

          <section aria-labelledby="viewer-classes" className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
            <h2 id="viewer-classes" className="px-4 pt-4 text-sm font-semibold uppercase tracking-wider text-watch-600">Classes</h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
                <tr>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Dates</th>
                  <th className="px-3 py-2">Coordinators</th>
                  <th className="px-3 py-2 text-right">Cadets enrolled</th>
                  <th className="px-3 py-2 text-right">Graduated</th>
                  <th className="px-3 py-2 text-right">Withdrawn or dismissed</th>
                  <th className="px-3 py-2 text-right">Sessions in range</th>
                  <th className="px-3 py-2 text-right">Open seats in range</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-watch-50">
                {data.academies.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No classes.</td></tr>
                )}
                {data.academies.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-watch-900">{a.shortName || a.name}</div>
                      <div className="text-xs text-slate-500">{a.name}{a.program ? ` · ${a.program}` : ''}</div>
                    </td>
                    <td className="px-3 py-2">{ACADEMY_STATUS[a.status] ?? a.status}</td>
                    <td className="whitespace-nowrap px-3 py-2">{a.startDate} to {a.endDate}</td>
                    <td className="px-3 py-2">{a.coordinators.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {a.cadets.enrolled}
                      {a.cadets.blockTakers > 0 && <div className="text-xs text-slate-500">+{a.cadets.blockTakers} block takers</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{a.cadets.graduated}</td>
                    <td className="px-3 py-2 text-right">{a.cadets.separated}</td>
                    <td className="px-3 py-2 text-right">{a.sessionsInRange}</td>
                    <td className="px-3 py-2 text-right">{a.openSeatsInRange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="viewer-sessions" className="space-y-4">
            <h2 id="viewer-sessions" className="text-sm font-semibold uppercase tracking-wider text-watch-600">Sessions</h2>
            {byDate.length === 0 && (
              <p className="rounded-lg border border-watch-100 bg-white p-6 text-center text-sm text-slate-500">
                No sessions {openOnly ? 'with open slots ' : ''}in this range.
              </p>
            )}
            {byDate.map((g) => (
              <div key={g.date} className="space-y-2">
                <h3 className="text-sm font-bold text-watch-900">{g.day} ({g.date})</h3>
                {g.items.map((s) => <SessionCard key={s.id} s={s} />)}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <th scope="row" className="py-0.5 pr-6 text-left font-normal text-slate-600">{label}</th>
      <td className="py-0.5 text-right font-semibold text-watch-900">{value}</td>
    </tr>
  );
}

function SessionCard({ s }: { s: ViewerSession }) {
  const state = STAFFING[s.staffing];
  return (
    <article className="rounded-lg border border-watch-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold text-watch-900">{s.start}–{s.end}</span>{' '}
          <span className="text-watch-900">{s.course}</span>
          {s.test && <span className="text-slate-500"> (test day)</span>}
          <span className="text-slate-500"> · {s.academy}{s.room ? ` · ${s.room}` : ''}{s.location ? ` · ${s.location}` : ''}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Badge tone={state.tone}>{state.label}</Badge>
          {s.staffing !== 'cancelled' && <span className="text-slate-600">{s.openSeats} open seat{s.openSeats === 1 ? '' : 's'}</span>}
        </div>
      </div>
      {s.slots.length > 0 && (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="py-1 pr-3">Role</th>
              <th className="py-1 pr-3">Qualification</th>
              <th className="py-1 pr-3">Filled by</th>
              <th className="py-1 pr-3 text-right">Needed</th>
              <th className="py-1 pr-3 text-right">Open</th>
              <th className="py-1 text-right">Waitlist</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {s.slots.map((sl, i) => (
              <tr key={i}>
                <td className="py-1 pr-3">{roleLabel(sl.role)}</td>
                <td className="py-1 pr-3 text-slate-600">{qualLabel(sl.requiredQualification)}</td>
                <td className="py-1 pr-3">
                  {sl.filled.length === 0
                    ? <span className="text-slate-400">—</span>
                    : sl.filled.map((f) => `${f.name}${f.awaitingConfirmation ? ' (awaiting confirmation)' : ''}`).join(', ')}
                </td>
                <td className="py-1 pr-3 text-right">{sl.needed}</td>
                <td className={`py-1 pr-3 text-right ${sl.open > 0 ? 'font-semibold text-red-700' : ''}`}>{sl.open}</td>
                <td className="py-1 text-right">{sl.waitlist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.writeIns.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          Also taught by: {s.writeIns.map((w) => `${w.name} (${roleLabel(w.role)})`).join(', ')}
        </p>
      )}
    </article>
  );
}
