/**
 * Remediation tracker — STAFF-ONLY (coordinator and up; instructors can't
 * even read the collection, see firestore.rules /remediations). Tracks cadets
 * who left an academy class incomplete — a block failure or an injury — and
 * must return with a later class to finish. Per case: the blocks still owed,
 * the class they'll return with, an optional agency assignment in the
 * meantime (location / date / supervisor), workers'-comp details for
 * injuries (injury date, next follow-up, restrictions, expected return),
 * and free-form notes.
 */
import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { AcademyDoc, RemediationBlock, RemediationDoc, RemediationStatus, RosterMemberDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';
import { lastFirst, rosterCompare } from './roster/rosterShared';

const STATUS_META: Record<RemediationStatus, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' | 'navy' }> = {
  awaiting: { label: 'Awaiting placement', tone: 'amber' },
  scheduled: { label: 'Return scheduled', tone: 'navy' },
  completed: { label: 'Completed', tone: 'green' },
  separated: { label: 'Separated', tone: 'slate' },
};
const STATUS_ORDER: RemediationStatus[] = ['awaiting', 'scheduled', 'completed', 'separated'];

/** yyyy-mm-dd → M/D/YYYY without Date() timezone pitfalls. */
function fmtDay(s?: string): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? `${m}/${d}/${y}` : s;
}
/** Today as a yyyy-mm-dd LOCAL string (ISO strings compare lexicographically). */
function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function RemediationPage() {
  const { data: cases, loading } = useCollection<RemediationDoc>('remediations');
  const [statusFilter, setStatusFilter] = useState<RemediationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WithId<RemediationDoc> | 'new' | null>(null);

  const today = todayStr();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of cases) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [cases]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases
      .filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter))
      .filter((r) => !q || r.personName.toLowerCase().includes(q) || (r.originalClass ?? '').toLowerCase().includes(q) || (r.makeupClass ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        // Open cases first (awaiting, then scheduled), closed at the bottom;
        // alphabetical by last name within each status.
        const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (s !== 0) return s;
        return lastFirst(a.personName).localeCompare(lastFirst(b.personName));
      });
  }, [cases, statusFilter, search]);

  return (
    <div>
      <PageHeader kicker="Cadre" title="Remediation & Returns" />
      <p className="-mt-4 mb-4 text-sm text-slate-500">
        Cadets who left a class with a block failure or injury and are returning with a later class to
        finish. Visible to coordinators and above only — instructors never see this page.
      </p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={statusFilter === 'all' ? 'secondary' : 'ghost'} onClick={() => setStatusFilter('all')}>
            All ({cases.length})
          </Button>
          {STATUS_ORDER.map((s) => (
            <Button key={s} variant={statusFilter === s ? 'secondary' : 'ghost'} onClick={() => setStatusFilter(s)}>
              {STATUS_META[s].label} ({counts[s] ?? 0})
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input type="search" placeholder="Search name or class…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="primary" onClick={() => setEditing('new')}>+ Add cadet</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-watch-100 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          {cases.length === 0
            ? 'No cadets are being tracked yet. Add one when a block failure or injury sends someone home to return with a later class.'
            : 'Nothing matches the current filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
              <tr>
                <th className="px-4 py-3">Cadet</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Blocks to make up</th>
                <th className="px-4 py-3">Return class</th>
                <th className="px-4 py-3">Current assignment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-watch-50">
              {rows.map((r) => {
                const open = r.status === 'awaiting' || r.status === 'scheduled';
                const followUpOverdue = open && !!r.injury?.nextFollowUp && r.injury.nextFollowUp < today;
                const totalHours = r.blocks.reduce((sum, b) => sum + (b.hours ?? 0), 0);
                return (
                  <tr key={r.id} className={open ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-watch-900">{lastFirst(r.personName)}</div>
                      <div className="text-xs text-slate-500">from {r.originalClass || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.reason === 'injury' ? (
                        <div>
                          <Badge tone="red">Injury</Badge>
                          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                            {r.injury?.injuredOn && <div>Injured {fmtDay(r.injury.injuredOn)}</div>}
                            {r.injury?.nextFollowUp && (
                              <div className={followUpOverdue ? 'font-semibold text-red-700' : ''}>
                                WC follow-up {fmtDay(r.injury.nextFollowUp)}
                                {followUpOverdue ? ' — overdue' : ''}
                              </div>
                            )}
                            {r.injury?.expectedReturn && <div>Expected return {fmtDay(r.injury.expectedReturn)}</div>}
                          </div>
                        </div>
                      ) : (
                        <Badge tone="amber">Block failure</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.blocks.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div>
                          <div className="text-watch-800">
                            {r.blocks.map((b) => b.course).join(', ')}
                          </div>
                          {totalHours > 0 && <div className="text-xs text-slate-500">{totalHours} hrs total</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.makeupClass ? (
                        <span className="font-medium text-watch-900">{r.makeupClass}</span>
                      ) : (
                        <span className="text-slate-400">not scheduled</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.assignment?.location ? (
                        <div>
                          <div className="text-watch-800">{r.assignment.location}</div>
                          <div className="text-xs text-slate-500">
                            {r.assignment.supervisor && <>Sup. {r.assignment.supervisor}</>}
                            {r.assignment.supervisor && r.assignment.assignedOn && ' · '}
                            {r.assignment.assignedOn && <>since {fmtDay(r.assignment.assignedOn)}</>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                      {r.notes?.trim() && (
                        <div className="mt-1 max-w-[16rem] truncate text-xs text-slate-500" title={r.notes}>
                          {r.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RemediationModal existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Blank editable block row. */
const emptyBlock = (): { course: string; hours: string; note: string } => ({ course: '', hours: '', note: '' });

function RemediationModal({ existing, onClose }: { existing: WithId<RemediationDoc> | null; onClose: () => void }) {
  const { firebaseUser, orgId } = useAuth();
  const { data: academies } = useCollection<AcademyDoc>('academies');

  const [sourceClassId, setSourceClassId] = useState(existing?.sourceAcademyId ?? '');
  const [sourceMemberId, setSourceMemberId] = useState(existing?.sourceMemberId ?? '');
  const [personName, setPersonName] = useState(existing?.personName ?? '');
  const [originalClass, setOriginalClass] = useState(existing?.originalClass ?? '');
  const [reason, setReason] = useState<RemediationDoc['reason']>(existing?.reason ?? 'block_failure');
  const [blocks, setBlocks] = useState<{ course: string; hours: string; note: string }[]>(
    existing?.blocks.length
      ? existing.blocks.map((b) => ({ course: b.course, hours: b.hours != null ? String(b.hours) : '', note: b.note ?? '' }))
      : [emptyBlock()]
  );
  const [makeupAcademyId, setMakeupAcademyId] = useState(existing?.makeupAcademyId ?? '');
  const [makeupClass, setMakeupClass] = useState(existing?.makeupClass ?? '');
  const [status, setStatus] = useState<RemediationStatus>(existing?.status ?? 'awaiting');
  const [hasAssignment, setHasAssignment] = useState(!!existing?.assignment?.location);
  const [assignLocation, setAssignLocation] = useState(existing?.assignment?.location ?? '');
  const [assignOn, setAssignOn] = useState(existing?.assignment?.assignedOn ?? '');
  const [assignSupervisor, setAssignSupervisor] = useState(existing?.assignment?.supervisor ?? '');
  const [injuredOn, setInjuredOn] = useState(existing?.injury?.injuredOn ?? '');
  const [nextFollowUp, setNextFollowUp] = useState(existing?.injury?.nextFollowUp ?? '');
  const [restrictions, setRestrictions] = useState(existing?.injury?.restrictions ?? '');
  const [expectedReturn, setExpectedReturn] = useState(existing?.injury?.expectedReturn ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cadet picker — pick the original class, then the cadet, exactly like the
  // crossover-memo flow. Everything stays manually editable (pre-HEIMDALL
  // classes won't be in the list).
  const { data: sourceRoster } = useCollection<RosterMemberDoc>(
    sourceClassId ? `academies/${sourceClassId}/roster` : null,
    [],
    [sourceClassId]
  );
  const classes = useMemo(
    () => academies.filter((a) => !a.isTemplate).sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name)),
    [academies]
  );
  const rosterSorted = useMemo(() => [...sourceRoster].sort(rosterCompare), [sourceRoster]);

  function pickSourceClass(id: string) {
    setSourceClassId(id);
    setSourceMemberId('');
    const a = academies.find((x) => x.id === id);
    if (a) setOriginalClass(a.shortName || a.name);
  }
  function pickSourceMember(id: string) {
    setSourceMemberId(id);
    const m = sourceRoster.find((r) => r.id === id);
    if (m) setPersonName(m.fullName);
  }
  function pickMakeupClass(id: string) {
    setMakeupAcademyId(id);
    const a = academies.find((x) => x.id === id);
    setMakeupClass(a ? a.shortName || a.name : '');
    // Placing them in a class is what "scheduled" means — flip it automatically
    // (still editable below).
    if (id && status === 'awaiting') setStatus('scheduled');
    if (!id && status === 'scheduled') setStatus('awaiting');
  }

  const setBlock = (i: number, patch: Partial<{ course: string; hours: string; note: string }>) =>
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = personName.trim();
    if (!name) { setError('Cadet name is required.'); return; }
    const cleanBlocks: RemediationBlock[] = blocks
      .filter((b) => b.course.trim())
      .map((b) => ({
        course: b.course.trim(),
        ...(b.hours.trim() && !Number.isNaN(Number(b.hours)) ? { hours: Number(b.hours) } : {}),
        ...(b.note.trim() ? { note: b.note.trim() } : {}),
      }));
    setBusy(true);
    setError(null);
    // Full-shape payload: optional groups are explicit null when absent so an
    // edit can CLEAR them (getFirestore never accepts undefined).
    const payload = {
      orgId,
      personName: name,
      sourceAcademyId: sourceClassId || null,
      sourceMemberId: sourceMemberId || null,
      originalClass: originalClass.trim(),
      reason,
      blocks: cleanBlocks,
      makeupAcademyId: makeupAcademyId || null,
      makeupClass: makeupClass.trim(),
      status,
      assignment: hasAssignment && assignLocation.trim()
        ? {
            location: assignLocation.trim(),
            ...(assignOn ? { assignedOn: assignOn } : {}),
            ...(assignSupervisor.trim() ? { supervisor: assignSupervisor.trim() } : {}),
          }
        : null,
      injury: reason === 'injury'
        ? {
            ...(injuredOn ? { injuredOn } : {}),
            ...(nextFollowUp ? { nextFollowUp } : {}),
            ...(restrictions.trim() ? { restrictions: restrictions.trim() } : {}),
            ...(expectedReturn ? { expectedReturn } : {}),
          }
        : null,
      notes: notes.trim(),
      updatedAt: serverTimestamp(),
    };
    try {
      if (existing) {
        await updateDoc(doc(db, 'remediations', existing.id), payload);
        await logAudit(firebaseUser!.uid, 'remediation.update', 'remediation', existing.id, `Updated remediation case for ${name}`);
      } else {
        const ref = await addDoc(collection(db, 'remediations'), {
          ...payload,
          createdBy: firebaseUser!.uid,
          createdAt: serverTimestamp(),
        });
        await logAudit(firebaseUser!.uid, 'remediation.create', 'remediation', ref.id, `Started tracking ${name} (${originalClass || 'no class'}, ${reason === 'injury' ? 'injury' : 'block failure'})`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!window.confirm(`Remove ${existing.personName} from the tracker? This deletes the case (their academy records are untouched).`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'remediations', existing.id));
      await logAudit(firebaseUser!.uid, 'remediation.delete', 'remediation', existing.id, `Removed remediation case for ${existing.personName}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={existing ? `Edit — ${existing.personName}` : 'Track a returning cadet'} wide>
      <form onSubmit={save} className="space-y-4 text-sm">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</div>}

        {/* Who + where they came from */}
        <div className="rounded-md border border-watch-100 bg-watch-50/50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-watch-600">Cadet &amp; original class</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Original class" hint="Pick to load its roster; or type below for older classes.">
              <Select value={sourceClassId} onChange={(e) => pickSourceClass(e.target.value)}>
                <option value="">— select a class —</option>
                {classes.map((a) => (
                  <option key={a.id} value={a.id}>{a.shortName || a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Cadet">
              <Select value={sourceMemberId} onChange={(e) => pickSourceMember(e.target.value)} disabled={!sourceClassId}>
                <option value="">{sourceClassId ? '— select the cadet —' : 'pick a class first'}</option>
                {rosterSorted.map((m) => (
                  <option key={m.id} value={m.id}>{lastFirst(m.fullName)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Cadet name">
              <Input value={personName} onChange={(e) => setPersonName(e.target.value)} required />
            </Field>
            <Field label="Original class (as displayed)">
              <Input value={originalClass} onChange={(e) => setOriginalClass(e.target.value)} placeholder='e.g. "LE 132"' />
            </Field>
          </div>
        </div>

        {/* Why they're here */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value as RemediationDoc['reason'])}>
              <option value="block_failure">Block failure</option>
              <option value="injury">Injury</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as RemediationStatus)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Injury / workers' comp — only when the reason is an injury */}
        {reason === 'injury' && (
          <div className="rounded-md border border-red-100 bg-red-50/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-800">Injury &amp; workers&apos; comp</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date injured">
                <Input type="date" value={injuredOn} onChange={(e) => setInjuredOn(e.target.value)} />
              </Field>
              <Field label="Next WC follow-up">
                <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
              </Field>
              <Field label="Expected return">
                <Input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
              </Field>
            </div>
            <Field label="Restrictions given by workers' comp" className="mt-2">
              <TextArea rows={2} value={restrictions} onChange={(e) => setRestrictions(e.target.value)} placeholder="e.g. no running, no lifting over 20 lbs, light duty only…" />
            </Field>
          </div>
        )}

        {/* What they owe */}
        <div className="rounded-md border border-watch-100 bg-watch-50/50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-watch-600">Blocks / courses to make up</div>
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Course / block (e.g. Criminal Justice Defensive Tactics)"
                  value={b.course}
                  onChange={(e) => setBlock(i, { course: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  className="w-24"
                  placeholder="Hours"
                  value={b.hours}
                  onChange={(e) => setBlock(i, { hours: e.target.value })}
                />
                <Input
                  className="w-40"
                  placeholder="Note (optional)"
                  value={b.note}
                  onChange={(e) => setBlock(i, { note: e.target.value })}
                />
                <Button type="button" variant="ghost" className="text-red-700" onClick={() => setBlocks((p) => p.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setBlocks((p) => [...p, emptyBlock()])}>
            + Add block
          </Button>
        </div>

        {/* Where they finish */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Return class" hint="The class they'll attend to make up the hours.">
            <Select value={makeupAcademyId} onChange={(e) => pickMakeupClass(e.target.value)}>
              <option value="">— not scheduled yet —</option>
              {classes.map((a) => (
                <option key={a.id} value={a.id}>{a.shortName || a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Return class (as displayed)">
            <Input value={makeupClass} onChange={(e) => setMakeupClass(e.target.value)} placeholder='e.g. "LE 133"' />
          </Field>
        </div>

        {/* Where the agency has them in the meantime */}
        <div className="rounded-md border border-watch-100 bg-watch-50/50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-watch-800">
            <input type="checkbox" checked={hasAssignment} onChange={(e) => setHasAssignment(e.target.checked)} />
            Currently assigned within the agency
          </label>
          {hasAssignment && (
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Assigned to">
                <Input value={assignLocation} onChange={(e) => setAssignLocation(e.target.value)} placeholder="e.g. Fleet Services, District 2 desk" />
              </Field>
              <Field label="Assigned on">
                <Input type="date" value={assignOn} onChange={(e) => setAssignOn(e.target.value)} />
              </Field>
              <Field label="Immediate supervisor">
                <Input value={assignSupervisor} onChange={(e) => setAssignSupervisor(e.target.value)} placeholder="e.g. Sgt. R. Alvarez" />
              </Field>
            </div>
          )}
        </div>

        <Field label="Notes" hint="Anything worth seeing at a glance that isn't tracked above.">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex items-center justify-between gap-2">
          <span>
            {existing && (
              <Button type="button" variant="ghost" className="text-red-700" disabled={busy} onClick={remove}>
                Delete case
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !personName.trim()}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Start tracking'}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
