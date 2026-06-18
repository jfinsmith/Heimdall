/**
 * CADRE — Staffing Dashboard (coordinator/command).
 * Kanban board (Draft / Open / Understaffed / Fully Staffed), "needs
 * attention" panel, per-instructor load, per-course coverage, and bulk
 * messaging via Gjallarhorn (writes a `bulkMessages` doc that a Cloud
 * Function fans out to mail + notifications).
 */
import React, { useMemo, useState } from 'react';
import { addDoc, collection, orderBy, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useGlobalSettings } from '../../app/providers';
import { fmtRange } from '../../lib/time';
import type { AcademyDoc, AssignmentDoc, SessionDoc } from '../../types';
import { unfilledSlots } from '../../types';
import { Badge, Button, EmptyState, Field, HighLiabilityBadge, PageHeader, Select, TextArea, Input } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { SessionDetailModal } from '../sessions/SessionDetailModal';

type Column = 'draft' | 'scheduled' | 'understaffed' | 'fully_staffed';

export function StaffingBoardPage() {
  const settings = useGlobalSettings();
  const alertDays = settings?.understaffingAlertDays ?? 7;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  const { data: allAcademies } = useCollection<AcademyDoc>('academies');
  const academies = useMemo(() => allAcademies.filter((a) => !a.isTemplate), [allAcademies]);
  const templateIds = useMemo(() => new Set(allAcademies.filter((a) => a.isTemplate).map((a) => a.id)), [allAcademies]);
  const { data: allSessions } = useCollection<SessionDoc>(
    'sessions',
    [where('start', '>=', Timestamp.now()), orderBy('start')],
    []
  );
  const sessions = useMemo(() => allSessions.filter((s) => !templateIds.has(s.academyId)), [allSessions, templateIds]);
  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    [where('status', '==', 'confirmed')],
    []
  );

  const columns = useMemo(() => {
    const cols: Record<Column, WithId<SessionDoc>[]> = { draft: [], scheduled: [], understaffed: [], fully_staffed: [] };
    for (const s of sessions) {
      if (s.status === 'cancelled' || s.status === 'completed') continue;
      if (s.kind === 'lunch') continue; // placeholders aren't staffable
      if (s.status === 'draft') cols.draft.push(s);
      // 'scheduled' = on the calendar but sign-ups not opened yet — staffing
      // math doesn't apply until a coordinator opens the course.
      else if (s.status === 'scheduled') cols.scheduled.push(s);
      else if (unfilledSlots(s).length === 0) cols.fully_staffed.push(s);
      else cols.understaffed.push(s);
    }
    return cols;
  }, [sessions]);

  /** Needs attention: OPEN sessions within N days missing lead or high-liability safety slots. */
  const needsAttention = useMemo(
    () =>
      sessions.filter((s) => {
        if (s.status !== 'open' && s.status !== 'fully_staffed') return false;
        const days = (s.start.toMillis() - Date.now()) / 864e5;
        if (days > alertDays) return false;
        return unfilledSlots(s).some(
          (sl) => sl.role === 'lead' || (s.highLiability && sl.role === 'safety_officer')
        );
      }),
    [sessions, alertDays]
  );

  /** Per-instructor load (upcoming confirmed hours + session count). */
  const instructorLoad = useMemo(() => {
    const map = new Map<string, { name: string; sessions: number; hours: number }>();
    for (const a of assignments) {
      if (a.end.toMillis() < Date.now()) continue;
      const hrs = (a.end.toMillis() - a.start.toMillis()) / 36e5;
      const cur = map.get(a.uid) ?? { name: a.uid, sessions: 0, hours: 0 };
      cur.sessions += 1;
      cur.hours += hrs;
      map.set(a.uid, cur);
    }
    return map;
  }, [assignments]);

  /** Per-course coverage across upcoming sessions. */
  const courseCoverage = useMemo(() => {
    const map = new Map<string, { total: number; filled: number }>();
    for (const s of sessions) {
      if (s.status === 'cancelled' || s.status === 'completed') continue;
      const cur = map.get(s.courseName) ?? { total: 0, filled: 0 };
      for (const slot of s.roleSlots) {
        cur.total += slot.count;
        cur.filled += Math.min(slot.filledBy.length, slot.count);
      }
      map.set(s.courseName, cur);
    }
    return [...map.entries()].sort((a, b) => a[1].filled / a[1].total - b[1].filled / b[1].total);
  }, [sessions]);

  const colMeta: Record<Column, { title: string; tone: string }> = {
    draft: { title: 'Draft', tone: 'border-t-status-draft' },
    scheduled: { title: 'Scheduled — sign-up closed', tone: 'border-t-watch-600' },
    understaffed: { title: 'Understaffed', tone: 'border-t-status-critical' },
    fully_staffed: { title: 'Fully staffed', tone: 'border-t-status-staffed' },
  };

  return (
    <div>
      <PageHeader
        kicker="CADRE — Staffing Dashboard"
        title="Staffing Board"
        actions={
          <Button variant="primary" onClick={() => setMessageOpen(true)}>
            Bulk message
          </Button>
        }
      />

      {/* Needs attention */}
      {needsAttention.length > 0 && (
        <section className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-red-800">
            Needs attention — inside the {alertDays}-day window
          </h2>
          <ul className="space-y-1.5">
            {needsAttention.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-red-900">
                <button className="font-medium hover:underline" onClick={() => setDetailId(s.id)}>
                  {s.title || s.courseName}
                </button>
                <span>{fmtRange(s.start, s.end)}</span>
                <span>
                  — missing{' '}
                  {unfilledSlots(s)
                    .map((sl) => `${sl.count - sl.filledBy.length} ${sl.role.replace('_', ' ')}`)
                    .join(', ')}
                </span>
                {s.highLiability && <HighLiabilityBadge />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Kanban board */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(colMeta) as Column[]).map((col) => (
          <div key={col} className={`rounded-lg border border-watch-100 border-t-4 bg-white shadow-sm ${colMeta[col].tone}`}>
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-sm font-semibold text-watch-800">{colMeta[col].title}</h3>
              <Badge tone="slate">{columns[col].length}</Badge>
            </div>
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto px-3 pb-3">
              {columns[col].map((s) => (
                <li key={s.id}>
                  <button
                    className="w-full rounded-md border border-watch-100 px-3 py-2 text-left text-sm hover:border-bifrost-300"
                    onClick={() => setDetailId(s.id)}
                  >
                    <div className="font-medium text-watch-900">
                      <span className="mr-1.5 rounded bg-watch-100 px-1 py-0.5 text-[10px] font-bold text-watch-700">
                        {academies.find((a) => a.id === s.academyId)?.shortName || '—'}
                      </span>
                      {s.title || s.courseName}
                    </div>
                    <div className="text-xs text-slate-500">{fmtRange(s.start, s.end)}</div>
                    {col === 'understaffed' && (
                      <div className="mt-1 text-xs text-amber-700">
                        {unfilledSlots(s)
                          .map((sl) => `${sl.count - sl.filledBy.length}× ${sl.role.replace('_', ' ')}`)
                          .join(', ')}
                      </div>
                    )}
                  </button>
                </li>
              ))}
              {columns[col].length === 0 && <li className="py-4 text-center text-xs text-slate-300">—</li>}
            </ul>
          </div>
        ))}
      </div>

      {/* Load + coverage */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">Per-course coverage</h2>
          {courseCoverage.length === 0 ? (
            <EmptyState title="No upcoming sessions" />
          ) : (
            <ul className="space-y-2">
              {courseCoverage.map(([course, { total, filled }]) => (
                <li key={course} className="text-sm">
                  <div className="mb-0.5 flex justify-between">
                    <span className="text-watch-800">{course}</span>
                    <span className="text-slate-500">
                      {filled}/{total} slots
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-watch-100">
                    <div
                      className={filled === total ? 'h-full bg-status-staffed' : 'h-full bg-status-open'}
                      style={{ width: `${total ? (filled / total) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">
            Per-instructor load (upcoming)
          </h2>
          <InstructorLoadTable load={instructorLoad} />
        </section>
      </div>

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
      {messageOpen && <BulkMessageModal academies={academies} onClose={() => setMessageOpen(false)} />}
    </div>
  );
}

function InstructorLoadTable({ load }: { load: Map<string, { name: string; sessions: number; hours: number }> }) {
  const { data: users } = useCollection<{ displayName: string }>('users');
  const rows = [...load.entries()]
    .map(([uid, l]) => ({ uid, ...l, name: users.find((u) => u.id === uid)?.displayName ?? uid }))
    .sort((a, b) => b.hours - a.hours);
  if (rows.length === 0) return <EmptyState title="No upcoming assignments" />;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wider text-watch-500">
        <tr>
          <th className="py-1">Instructor</th>
          <th className="py-1 text-right">Sessions</th>
          <th className="py-1 text-right">Hours</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-watch-50">
        {rows.map((r) => (
          <tr key={r.uid}>
            <td className="py-1.5 text-watch-800">{r.name}</td>
            <td className="py-1.5 text-right">{r.sessions}</td>
            <td className="py-1.5 text-right">{r.hours.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Bulk message: writes a `bulkMessages` doc; the Gjallarhorn
 * `onBulkMessageCreated` function fans it out to email + in-app notifications
 * (clients cannot write to `mail/` directly — rules forbid it).
 */
function BulkMessageModal({ academies, onClose }: { academies: WithId<AcademyDoc>[]; onClose: () => void }) {
  const { firebaseUser, orgId } = useAuth();
  const [academyId, setAcademyId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await addDoc(collection(db, 'bulkMessages'), {
      academyId,                       // '' = all signed-up instructors everywhere
      ...(orgId ? { orgId } : {}),     // tenant scope (dormant until backfill)
      subject,
      body,
      requestedBy: firebaseUser?.uid ?? '',
      status: 'pending',               // function flips to 'sent'
      createdAt: serverTimestamp(),
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <Modal open onClose={onClose} title="Bulk message signed-up instructors">
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-green-800">Queued. Gjallarhorn will sound it within a minute.</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Audience">
            <Select value={academyId} onChange={(e) => setAcademyId(e.target.value)}>
              <option value="">All instructors with upcoming assignments</option>
              {[...academies].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
                <option key={a.id} value={a.id}>
                  Signed-up instructors — {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </Field>
          <Field label="Message">
            <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Sound Gjallarhorn
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
