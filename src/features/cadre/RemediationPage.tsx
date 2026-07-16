/**
 * Remediation tracker — STAFF-ONLY (coordinator and up; instructors can't
 * even read the collection, see firestore.rules /remediations). Tracks cadets
 * who left an academy class incomplete — a block failure or an injury — or
 * are crossing over between disciplines, and must attend a later class to
 * finish. Per case: the blocks still owed (check-off pills; crossovers
 * auto-fill from the FDLE crossover program), the class they'll return with,
 * an optional agency assignment in the meantime (location / date /
 * supervisor), workers'-comp details for injuries (injury date, next
 * follow-up, restrictions, return date), free-form notes, and a resolve
 * outcome (full duty / resigned / transferred) that archives the case.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { AcademyDoc, RemediationBlock, RemediationDoc, RemediationStatus, RosterMemberDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';
import { lastFirst, rosterCompare } from './roster/rosterShared';
import { useCurriculum } from '../../lib/curricula';

const STATUS_META: Record<RemediationStatus, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' | 'navy' }> = {
  awaiting: { label: 'Awaiting placement', tone: 'amber' },
  scheduled: { label: 'Return scheduled', tone: 'navy' },
  completed: { label: 'Completed', tone: 'green' },
  separated: { label: 'Separated', tone: 'slate' },
};
const STATUS_ORDER: RemediationStatus[] = ['awaiting', 'scheduled', 'completed', 'separated'];

const REASON_META: Record<RemediationDoc['reason'], { label: string; tone: 'slate' | 'amber' | 'green' | 'red' | 'navy' }> = {
  block_failure: { label: 'Block failure', tone: 'amber' },
  injury: { label: 'Injury', tone: 'red' },
  crossover: { label: 'Crossover', tone: 'navy' },
};

const OUTCOME_META: Record<NonNullable<RemediationDoc['outcome']>, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' | 'navy'; hint: string }> = {
  full_duty: { label: 'Returned to full duty', tone: 'green', hint: 'Finished their make-up work (or recovered) — back on the job.' },
  resigned: { label: 'Resigned', tone: 'slate', hint: 'Left the agency; no return expected.' },
  transferred: { label: 'Transferred', tone: 'navy', hint: 'Moved to another agency or program.' },
};

const DIRECTION_LABEL: Record<'co_to_le' | 'le_to_co', string> = {
  co_to_le: 'Corrections → Law Enforcement',
  le_to_co: 'Law Enforcement → Corrections',
};

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
  const { firebaseUser } = useAuth();
  const { data: cases, loading } = useCollection<RemediationDoc>('remediations');
  const [statusFilter, setStatusFilter] = useState<RemediationStatus | 'all' | 'archived'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WithId<RemediationDoc> | 'new' | null>(null);
  const [resolving, setResolving] = useState<WithId<RemediationDoc> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const today = todayStr();
  const active = useMemo(() => cases.filter((r) => !r.archived), [cases]);
  const archivedCount = cases.length - active.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of active) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [active]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases
      .filter((r) => (statusFilter === 'archived' ? !!r.archived : !r.archived && (statusFilter === 'all' || r.status === statusFilter)))
      .filter((r) => !q || r.personName.toLowerCase().includes(q) || (r.originalClass ?? '').toLowerCase().includes(q) || (r.makeupClass ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        // Open cases first (awaiting, then scheduled), closed at the bottom;
        // alphabetical by last name within each status.
        const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (s !== 0) return s;
        return lastFirst(a.personName).localeCompare(lastFirst(b.personName));
      });
  }, [cases, statusFilter, search]);

  /** Check a block off (or back on) straight from the list. */
  async function toggleBlock(r: WithId<RemediationDoc>, index: number) {
    setBusy(r.id);
    try {
      const next = r.blocks.map((b, i) => {
        if (i !== index) return b;
        const { completed: _drop, ...rest } = b;
        return b.completed ? rest : { ...rest, completed: true };
      });
      await updateDoc(doc(db, 'remediations', r.id), { blocks: next, updatedAt: serverTimestamp() });
      const b = r.blocks[index];
      await logAudit(
        firebaseUser!.uid, 'remediation.update', 'remediation', r.id,
        `${b.completed ? 'Un-checked' : 'Completed'} ${b.course} for ${r.personName}`
      );
    } catch (err) {
      window.alert(`Could not update the block: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  async function restore(r: WithId<RemediationDoc>) {
    setBusy(r.id);
    try {
      await updateDoc(doc(db, 'remediations', r.id), { archived: false, updatedAt: serverTimestamp() });
      await logAudit(firebaseUser!.uid, 'remediation.restore', 'remediation', r.id, `Restored remediation case for ${r.personName}`);
    } catch (err) {
      window.alert(`Could not restore: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteCase(r: WithId<RemediationDoc>) {
    if (!window.confirm(`Permanently delete ${r.personName}'s case? This cannot be undone (their academy records are untouched). Use Resolve instead if you just want it out of the way.`)) return;
    setBusy(r.id);
    try {
      await deleteDoc(doc(db, 'remediations', r.id));
      await logAudit(firebaseUser!.uid, 'remediation.delete', 'remediation', r.id, `Deleted remediation case for ${r.personName}`);
    } catch (err) {
      window.alert(`Could not delete: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader kicker="Cadre" title="Remediation & Returns" />
      <p className="-mt-4 mb-4 text-sm text-slate-500">
        Cadets finishing with a later class — after a block failure, an injury, or a crossover between
        disciplines. Click a block pill to check it off. Visible to coordinators and above only —
        instructors never see this page.
      </p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={statusFilter === 'all' ? 'secondary' : 'ghost'} onClick={() => setStatusFilter('all')}>
            All ({active.length})
          </Button>
          {STATUS_ORDER.map((s) => (
            <Button key={s} variant={statusFilter === s ? 'secondary' : 'ghost'} onClick={() => setStatusFilter(s)}>
              {STATUS_META[s].label} ({counts[s] ?? 0})
            </Button>
          ))}
          <Button variant={statusFilter === 'archived' ? 'secondary' : 'ghost'} onClick={() => setStatusFilter('archived')}>
            Archived ({archivedCount})
          </Button>
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
            : statusFilter === 'archived'
              ? 'No archived cases yet — Resolve a case to move it here.'
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
                // A set return date means the WC track has an answer — the
                // follow-up date stops counting as overdue.
                const followUpOverdue =
                  open && !!r.injury?.nextFollowUp && r.injury.nextFollowUp < today && !r.injury?.expectedReturn;
                const totalHours = r.blocks.reduce((sum, b) => sum + (b.hours ?? 0), 0);
                return (
                  <tr key={r.id} className={open ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-watch-900">{lastFirst(r.personName)}</div>
                      <div className="text-xs text-slate-500">from {r.originalClass || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={REASON_META[r.reason].tone}>{REASON_META[r.reason].label}</Badge>
                      {r.reason === 'crossover' && r.crossoverDirection && (
                        <div className="mt-1 text-xs text-slate-500">{DIRECTION_LABEL[r.crossoverDirection]}</div>
                      )}
                      {r.reason === 'injury' && (
                        <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                          {r.injury?.injuredOn && <div>Injured {fmtDay(r.injury.injuredOn)}</div>}
                          {r.injury?.nextFollowUp && (
                            <div className={followUpOverdue ? 'font-semibold text-red-700' : ''}>
                              WC follow-up {fmtDay(r.injury.nextFollowUp)}
                              {followUpOverdue ? ' — overdue' : ''}
                            </div>
                          )}
                          {r.injury?.expectedReturn && <div>Return date {fmtDay(r.injury.expectedReturn)}</div>}
                          {r.injury?.restrictions && (
                            <div className="max-w-[18rem] text-red-700">{r.injury.restrictions}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.blocks.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div>
                          {/* One pill per block — click to check it off. ▲ red =
                              high-liability, green ✓ = completed. */}
                          <div className="flex max-w-lg flex-wrap gap-1.5">
                            {r.blocks.map((b, i) => (
                              <button
                                key={i}
                                type="button"
                                disabled={!!r.archived || busy === r.id}
                                onClick={() => toggleBlock(r, i)}
                                title={r.archived ? undefined : b.completed ? 'Completed — click to un-check' : 'Click when the block is completed'}
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${
                                  b.completed
                                    ? 'bg-green-50 text-green-700 ring-green-300'
                                    : b.highLiability
                                      ? 'bg-red-50 text-red-700 ring-red-200'
                                      : 'bg-watch-50 text-watch-700 ring-watch-200'
                                } ${r.archived ? '' : 'hover:ring-2'}`}
                              >
                                {b.completed ? '✓' : b.highLiability ? '▲' : null}
                                <span className={b.completed ? 'line-through opacity-70' : ''}>{b.course}</span>
                              </button>
                            ))}
                          </div>
                          <div className="mt-1.5 text-xs text-slate-500">
                            {r.blocks.some((b) => b.completed) && (
                              <>{r.blocks.filter((b) => b.completed).length}/{r.blocks.length} done · </>
                            )}
                            {totalHours > 0 && <>{totalHours} hrs total</>}
                          </div>
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
                      <span className="inline-flex flex-wrap gap-1">
                        <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                        {r.outcome && <Badge tone={OUTCOME_META[r.outcome].tone}>{OUTCOME_META[r.outcome].label}</Badge>}
                        {r.archived && <Badge tone="slate">Archived</Badge>}
                      </span>
                      {r.notes?.trim() && (
                        <div className="mt-1 max-w-[16rem] truncate text-xs text-slate-500" title={r.notes}>
                          {r.notes}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {r.archived ? (
                        <>
                          <Button variant="ghost" disabled={busy === r.id} onClick={() => restore(r)}>Restore</Button>
                          <Button variant="ghost" className="text-red-700" disabled={busy === r.id} onClick={() => deleteCase(r)}>Delete</Button>
                        </>
                      ) : (
                        <Button variant="ghost" className="text-green-700" disabled={busy === r.id} onClick={() => setResolving(r)}>Resolve</Button>
                      )}
                      <Button variant="ghost" disabled={busy === r.id} onClick={() => setEditing(r)}>Edit</Button>
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
      {resolving && <ResolveModal caseDoc={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}

/**
 * Resolving asks HOW the case ended — the outcome drives the final status
 * (full duty → Completed, resigned/transferred → Separated) and shows as a
 * badge on the archived row.
 */
function ResolveModal({ caseDoc, onClose }: { caseDoc: WithId<RemediationDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(outcome: NonNullable<RemediationDoc['outcome']>) {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'remediations', caseDoc.id), {
        archived: true,
        outcome,
        status: outcome === 'full_duty' ? 'completed' : 'separated',
        updatedAt: serverTimestamp(),
      });
      await logAudit(
        firebaseUser!.uid, 'remediation.resolve', 'remediation', caseDoc.id,
        `Resolved ${caseDoc.personName}: ${OUTCOME_META[outcome].label} (archived)`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Resolve — ${caseDoc.personName}`}>
      <div className="space-y-4 text-sm">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</div>}
        <p className="text-slate-600">
          How did this case end? The case is archived (under the Archived filter, restorable any time) and
          stops flagging follow-ups.
        </p>
        <div className="space-y-2">
          {(Object.keys(OUTCOME_META) as NonNullable<RemediationDoc['outcome']>[]).map((o) => (
            <button
              key={o}
              type="button"
              disabled={busy}
              onClick={() => finish(o)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-watch-100 bg-white px-3 py-2.5 text-left hover:border-bifrost-300 hover:bg-watch-50 disabled:opacity-50"
            >
              <span>
                <span className="font-medium text-watch-900">{OUTCOME_META[o].label}</span>
                <span className="block text-xs text-slate-500">{OUTCOME_META[o].hint}</span>
              </span>
              <Badge tone={OUTCOME_META[o].tone}>{o === 'full_duty' ? 'Completed' : 'Separated'}</Badge>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Blank editable block row. `custom` = the coordinator chose "Custom…" over a curriculum course.
 *  Hours ride along invisibly (stamped from the curriculum) — shown only on the list. */
type BlockRow = { course: string; hours: string; custom: boolean; highLiability: boolean; completed: boolean };
const emptyBlock = (): BlockRow => ({ course: '', hours: '', custom: false, highLiability: false, completed: false });

function RemediationModal({ existing, onClose }: { existing: WithId<RemediationDoc> | null; onClose: () => void }) {
  const { firebaseUser, orgId } = useAuth();
  const { data: academies } = useCollection<AcademyDoc>('academies');

  const [sourceClassId, setSourceClassId] = useState(existing?.sourceAcademyId ?? '');
  const [sourceMemberId, setSourceMemberId] = useState(existing?.sourceMemberId ?? '');
  const [personName, setPersonName] = useState(existing?.personName ?? '');
  const [originalClass, setOriginalClass] = useState(existing?.originalClass ?? '');
  const [reason, setReason] = useState<RemediationDoc['reason']>(existing?.reason ?? 'block_failure');
  const [direction, setDirection] = useState<'co_to_le' | 'le_to_co'>(existing?.crossoverDirection ?? 'co_to_le');
  const [blocks, setBlocks] = useState<BlockRow[]>(
    existing?.blocks.length
      ? existing.blocks.map((b) => ({
          course: b.course,
          hours: b.hours != null ? String(b.hours) : '',
          custom: false,
          highLiability: !!b.highLiability,
          completed: !!b.completed,
        }))
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
  // The original class's curriculum drives the blocks dropdown (hours + the
  // high-liability flag ride along from the FDLE course). Crossover cases use
  // the FDLE crossover program for the chosen direction instead. Manual /
  // pre-HEIMDALL entries fall back to free text.
  const sourceAcademy = academies.find((a) => a.id === sourceClassId);
  const { data: sourceCurriculum } = useCurriculum(sourceAcademy?.discipline ?? null);
  const { data: coToLe } = useCurriculum('co_to_le');
  const { data: leToCo } = useCurriculum('le_to_co');
  const crossoverCurriculum = direction === 'co_to_le' ? coToLe : leToCo;
  const curriculum = reason === 'crossover' ? crossoverCurriculum : sourceCurriculum;
  const curriculumCourses = useMemo(() => curriculum?.courses ?? [], [curriculum]);

  // Crossover auto-population: whenever the reason is crossover and the rows
  // are still blank (fresh pick, direction change, or the program doc just
  // arrived), load the FDLE crossover course list. Never clobbers rows the
  // coordinator has already filled in (e.g. editing a saved case).
  useEffect(() => {
    if (reason !== 'crossover' || !crossoverCurriculum) return;
    setBlocks((prev) =>
      prev.some((b) => b.course.trim())
        ? prev
        : crossoverCurriculum.courses.map((c) => ({
            course: c.name,
            hours: String(c.minHours),
            custom: false,
            highLiability: !!c.highLiability,
            completed: false,
          }))
    );
  }, [reason, direction, crossoverCurriculum]);

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

  const setBlock = (i: number, patch: Partial<BlockRow>) =>
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  /** Dropdown choice for a row: a curriculum course by name, Custom, or empty. */
  function pickBlockCourse(i: number, value: string) {
    if (value === '__custom__') {
      setBlock(i, { custom: true, highLiability: false });
      return;
    }
    const c = curriculumCourses.find((x) => x.name === value);
    setBlock(i, {
      custom: false,
      course: value,
      hours: c ? String(c.minHours) : '',
      highLiability: !!c?.highLiability,
    });
  }

  /** Switching reason to/from crossover resets blank-slate rows so the
   *  crossover effect (or a fresh manual list) can take over. */
  function pickReason(next: RemediationDoc['reason']) {
    setReason(next);
    if (next === 'crossover' || reason === 'crossover') setBlocks([emptyBlock()]);
  }
  function pickDirection(next: 'co_to_le' | 'le_to_co') {
    setDirection(next);
    setBlocks([emptyBlock()]); // repopulated by the crossover effect
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = personName.trim();
    if (!name) { setError('Cadet name is required.'); return; }
    const cleanBlocks: RemediationBlock[] = blocks
      .filter((b) => b.course.trim())
      .map((b) => ({
        course: b.course.trim(),
        ...(b.hours.trim() && !Number.isNaN(Number(b.hours)) ? { hours: Number(b.hours) } : {}),
        ...(b.highLiability ? { highLiability: true } : {}),
        ...(b.completed ? { completed: true } : {}),
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
      crossoverDirection: reason === 'crossover' ? direction : null,
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
        await logAudit(firebaseUser!.uid, 'remediation.create', 'remediation', ref.id, `Started tracking ${name} (${originalClass || 'no class'}, ${REASON_META[reason].label.toLowerCase()})`);
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
            <Select value={reason} onChange={(e) => pickReason(e.target.value as RemediationDoc['reason'])}>
              <option value="block_failure">Block failure</option>
              <option value="injury">Injury</option>
              <option value="crossover">Crossover</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as RemediationStatus)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </Select>
          </Field>
          {reason === 'crossover' && (
            <Field
              label="Crossover direction"
              hint="Auto-fills the blocks below with the FDLE crossover program's courses."
              className="sm:col-span-2"
            >
              <Select value={direction} onChange={(e) => pickDirection(e.target.value as 'co_to_le' | 'le_to_co')}>
                <option value="co_to_le">{DIRECTION_LABEL.co_to_le}</option>
                <option value="le_to_co">{DIRECTION_LABEL.le_to_co} (rare)</option>
              </Select>
            </Field>
          )}
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
              <Field label="Return date" hint="Setting this clears the overdue follow-up flag.">
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
            {blocks.map((b, i) => {
              // A stored course that isn't in the curriculum (or an explicit
              // "Custom…" choice) renders as free text.
              const isCustom = b.custom || (!!b.course && !curriculumCourses.some((c) => c.name === b.course));
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  {curriculumCourses.length > 0 ? (
                    <>
                      <Select
                        className="min-w-0 flex-1"
                        value={isCustom ? '__custom__' : b.course}
                        onChange={(e) => pickBlockCourse(i, e.target.value)}
                      >
                        <option value="">— select a course —</option>
                        {curriculumCourses.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.highLiability ? '▲ ' : ''}{c.cjk ? `${c.cjk} — ` : ''}{c.name}
                          </option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </Select>
                      {isCustom && (
                        <Input
                          className="min-w-0 flex-1"
                          placeholder="Custom course / block name"
                          value={b.course}
                          onChange={(e) => setBlock(i, { course: e.target.value })}
                        />
                      )}
                    </>
                  ) : (
                    <Input
                      className="min-w-0 flex-1"
                      placeholder="Course / block (pick the original class above to choose from its curriculum)"
                      value={b.course}
                      onChange={(e) => setBlock(i, { course: e.target.value })}
                    />
                  )}
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={b.completed} onChange={(e) => setBlock(i, { completed: e.target.checked })} />
                    Done
                  </label>
                  <Button type="button" variant="ghost" className="text-red-700" onClick={() => setBlocks((p) => p.filter((_, idx) => idx !== i))}>
                    ✕
                  </Button>
                </div>
              );
            })}
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
