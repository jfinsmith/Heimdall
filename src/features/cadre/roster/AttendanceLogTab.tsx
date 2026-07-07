/**
 * Attendance Log — VOLUNTARY digital attendance capture. Pick a date and record
 * each cadet's status + attended hours for that day (one Firestore doc per day:
 * academies/{id}/attendance/{date}); a running per-cadet attended-hours total
 * rolls up across every recorded day.
 *
 * The signed PAPER roster remains the official record of attendance — this is an
 * opt-in tally for academies that want the 770-hour total tracked in-app. Nothing
 * here is required; an academy that keeps paper simply never uses this tab.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useCollection, type WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import type { AttendanceDoc, AttendanceEntry, AttendanceStatus, RosterMemberDoc } from '../../../types';
import { Button, Field, Input, Select, Spinner } from '../../../components/ui';
import { lastFirst } from './rosterShared';

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'tardy', label: 'Tardy' },
  { value: 'excused', label: 'Excused' },
  { value: 'unexcused', label: 'Unexcused' },
  { value: 'makeup', label: 'Makeup' },
];

const todayKey = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function AttendanceLogTab({ academyId, members }: { academyId: string; members: WithId<RosterMemberDoc>[] }) {
  const { firebaseUser, orgId } = useAuth();
  // Canonical roster order arrives pre-sorted (alphabetical by last name).
  const cadets = useMemo(
    () => members.filter((m) => m.status !== 'withdrawn' && m.status !== 'dismissed' && !m.blockTaker),
    [members]
  );

  const { data: days, loading } = useCollection<AttendanceDoc>(academyId ? `academies/${academyId}/attendance` : null, [], [academyId]);
  const [date, setDate] = useState(todayKey());
  const [draft, setDraft] = useState<Record<string, AttendanceEntry>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const savedDay = useMemo(() => days.find((d) => d.id === date), [days, date]);
  useEffect(() => { setDraft(savedDay?.entries ?? {}); setSaved(false); }, [date, savedDay]);

  // Per-cadet attended-hours rollup across every recorded day.
  const totalHours = useMemo(() => {
    const m: Record<string, number> = {};
    for (const day of days) for (const [cid, e] of Object.entries(day.entries ?? {})) m[cid] = (m[cid] ?? 0) + (Number(e?.hours) || 0);
    return m;
  }, [days]);

  function setEntry(cadetId: string, patch: Partial<AttendanceEntry>) {
    setDraft((p) => {
      const cur: AttendanceEntry = p[cadetId] ?? { status: 'present', hours: 0 };
      return { ...p, [cadetId]: { ...cur, ...patch } };
    });
    setSaved(false);
  }

  async function save() {
    if (!orgId) return;
    setBusy(true);
    try {
      // Full overwrite (not merge) so clearing a cadet removes their entry.
      await setDoc(doc(db, `academies/${academyId}/attendance/${date}`), {
        orgId,
        academyId,
        date,
        entries: draft,
        updatedBy: firebaseUser?.uid ?? '',
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner className="text-bifrost-400" /></div>;

  return (
    <div>
      <p className="mb-3 max-w-2xl text-sm text-slate-500">
        Optional digital attendance. The signed paper roster remains the official record — use this only if you want
        attended hours tracked in-app (it keeps a running per-cadet total). Excused/absent days typically credit 0
        hours; set the hours per cadet as your program requires.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Class date" className="max-w-[12rem]"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</Button>
        {saved && <span className="pb-2 text-sm text-green-700">Saved.</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-watch-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="w-10 px-2 py-2">No.</th>
              <th className="px-2 py-2">Name</th>
              <th className="w-44 px-2 py-2">Status</th>
              <th className="w-28 px-2 py-2">Hours</th>
              <th className="w-32 px-2 py-2" title="Attended hours across all recorded days">Total attended</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {cadets.map((m) => {
              const e = draft[m.id];
              return (
                <tr key={m.id}>
                  <td className="px-2 py-1.5 tabular-nums text-slate-500">{m.no}</td>
                  <td className="px-2 py-1.5 font-medium text-watch-900">{lastFirst(m.fullName)}</td>
                  <td className="px-2 py-1.5">
                    <Select value={e?.status ?? ''} onChange={(ev) => setEntry(m.id, { status: ev.target.value as AttendanceStatus })}>
                      <option value="">— not recorded —</option>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min={0} step={0.25} value={e ? e.hours : ''} onChange={(ev) => setEntry(m.id, { hours: Number(ev.target.value) })} />
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{totalHours[m.id] ?? 0} hrs</td>
                </tr>
              );
            })}
            {cadets.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">No active cadets.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
