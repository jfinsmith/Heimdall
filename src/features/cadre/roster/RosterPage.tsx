/**
 * Academy Roster — per-academy cadet roster and the systems that hang off it:
 * a tiered intake wizard, the Members list, the
 * printable Attendance Roster, the Discipline tracker, and the Gradebook.
 * Real academies only — templates have no roster.
 */
import React, { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from '../../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../../lib/firestore';
import type { AcademyDoc, CurriculumDoc, RosterAgency, RosterMemberDoc } from '../../../types';
import { ROSTER_AGENCIES } from '../../../types';
import { Badge, Button, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { agencyLabel } from './rosterShared';
import { AttendanceTab } from './AttendanceTab';
import { DisciplineTab } from './DisciplineTab';
import { GradesTab } from './GradesTab';
import { AcademyReports } from '../reports/AcademyReports';
import { enabledRosterModules, ROSTER_MODULE_BY_KEY } from './rosterModules';
import type { RosterModuleKey } from '../../../types';

const rosterCreateMember = httpsCallable<
  { academyId: string; member: Record<string, unknown> },
  { ok: boolean; id: string; no: number }
>(functions, 'rosterCreateMember');

type Tab = 'members' | RosterModuleKey;

export function RosterPage() {
  const { academyId = '' } = useParams();
  const { data: academy, loading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: membersRaw, error: membersError } = useCollection<RosterMemberDoc>(
    academyId ? `academies/${academyId}/roster` : null,
    [],
    [academyId]
  );
  // useCollection org-scopes the roster subcollection; sort by roster number
  // client-side (dropping orderBy keeps the query on a single-field index).
  const members = useMemo(() => [...membersRaw].sort((a, b) => (a.no ?? 0) - (b.no ?? 0)), [membersRaw]);
  const { data: curriculum } = useDoc<CurriculumDoc>(academy ? `curricula/${academy.discipline}` : null);
  const [tab, setTab] = useState<Tab>('members');

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-bifrost-400" /></div>;
  if (!academy) return <p className="text-sm text-slate-500">Academy not found.</p>;
  if (academy.isTemplate) {
    return (
      <div>
        <PageHeader back kicker="Roster" title={academy.name} />
        <p className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
          Templates don’t have rosters. Create a real academy from this template first.
        </p>
      </div>
    );
  }

  const active = members.filter((m) => m.status !== 'withdrawn' && !m.blockTaker);
  const withdrawn = members.filter((m) => m.status === 'withdrawn');

  // Tabs are driven by the discipline's configured roster modules (Members
  // always shows). Configure these in Admin → Curriculum & Hours.
  const modules = enabledRosterModules(curriculum?.rosterModules);
  const TABS: { key: Tab; label: string }[] = [
    { key: 'members', label: 'Members' },
    ...modules.map((m) => ({ key: m.key as Tab, label: m.label })),
  ];
  // If the active tab isn't available for this discipline, fall back to Members.
  const activeTab: Tab = TABS.some((t) => t.key === tab) ? tab : 'members';
  const activeModule = ROSTER_MODULE_BY_KEY[activeTab as RosterModuleKey];

  return (
    <div>
      <div className="no-print">
        <PageHeader
          back
          kicker="Roster"
          title={`${academy.shortName ? academy.shortName + ' — ' : ''}${academy.name}`}
          actions={
            <Link to={`/cadre/academies/${academyId}`} className="text-sm text-bifrost-700 hover:underline">
              ← Back to builder
            </Link>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="green">{active.length} active</Badge>
          {withdrawn.length > 0 && <Badge tone="slate">{withdrawn.length} withdrawn</Badge>}
        </div>
        {membersError && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            Couldn’t load the roster (a permission error). If members exist in the database but not here, an
            org-stamp repair is needed — re-run the backfill or contact the platform owner.
          </div>
        )}

        {/* Tabs */}
        <div className="mb-5 flex gap-1 border-b border-watch-100">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                activeTab === t.key ? 'border-bifrost-500 text-bifrost-700' : 'border-transparent text-slate-500 hover:text-watch-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'members' && <MembersTab academyId={academyId} academy={academy} members={members} curriculum={curriculum} />}
      {activeModule?.attendanceFormat && <AttendanceTab academy={academy} members={members} curriculum={curriculum} />}
      {activeTab === 'discipline' && <DisciplineTab academyId={academyId} members={members} />}
      {activeTab === 'grades' && <GradesTab academyId={academyId} members={members} curriculum={curriculum} />}
      {activeTab === 'reports' && <AcademyReports academy={academy} />}
    </div>
  );
}

// ── Members tab ──────────────────────────────────────────────────────────────
function MembersTab({
  academyId,
  academy,
  members,
  curriculum,
}: {
  academyId: string;
  academy: WithId<AcademyDoc>;
  members: WithId<RosterMemberDoc>[];
  curriculum: WithId<CurriculumDoc> | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<WithId<RosterMemberDoc> | null>(null);

  async function remove(m: WithId<RosterMemberDoc>) {
    if (!window.confirm(`Remove ${m.fullName} from the roster entirely? To keep a record, withdraw them instead.`)) return;
    await deleteDoc(doc(db, 'academies', academyId, 'roster', m.id));
  }
  async function reinstate(m: WithId<RosterMemberDoc>) {
    await updateDoc(doc(db, 'academies', academyId, 'roster', m.id), { status: 'active', updatedAt: serverTimestamp() });
  }

  const full = members.filter((m) => !m.blockTaker);
  const blockTakers = members.filter((m) => m.blockTaker);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add member</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Agency</th>
              <th className="px-3 py-3">Contact</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {/* # is the LIVE position in the roster, not a stored id — so removing a
                member collapses the numbers below them (e.g. pull #23 → #24 becomes #23). */}
            {full.map((m, i) => (
              <MemberRow key={m.id} m={m} displayNo={i + 1}
                onWithdraw={() => setWithdrawTarget(m)} onReinstate={() => reinstate(m)} onRemove={() => remove(m)} />
            ))}
            {full.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">No members yet — add the first cadet.</td></tr>
            )}
          </tbody>
          {blockTakers.length > 0 && (
            <tbody className="divide-y divide-watch-50">
              <tr className="bg-watch-100/60"><td colSpan={6} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-watch-600">Additional block takers</td></tr>
              {blockTakers.map((m, i) => (
                <MemberRow key={m.id} m={m} displayNo={i + 1}
                  onWithdraw={() => setWithdrawTarget(m)} onReinstate={() => reinstate(m)} onRemove={() => remove(m)} />
              ))}
            </tbody>
          )}
        </table>
      </div>

      {addOpen && <IntakeWizard academyId={academyId} onClose={() => setAddOpen(false)} />}
      {withdrawTarget && (
        <WithdrawModal academyId={academyId} member={withdrawTarget} curriculum={curriculum} onClose={() => setWithdrawTarget(null)} />
      )}
    </div>
  );
}

function MemberRow({
  m, displayNo, onWithdraw, onReinstate, onRemove,
}: {
  m: WithId<RosterMemberDoc>;
  displayNo: number;
  onWithdraw: () => void; onReinstate: () => void; onRemove: () => void;
}) {
  const withdrawn = m.status === 'withdrawn';
  return (
    <tr className={withdrawn ? 'bg-slate-50 text-slate-400' : ''}>
      <td className="px-3 py-3 tabular-nums">{displayNo}</td>
      <td className="px-3 py-3 font-medium text-watch-900">
        <span className={withdrawn ? 'line-through' : ''}>{m.fullName}</span>
      </td>
      <td className="px-3 py-3">{agencyLabel(m)}</td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {m.email && <div>{m.email}</div>}
        {m.phone && <div>{m.phone}</div>}
      </td>
      <td className="px-3 py-3">
        {withdrawn ? <Badge tone="slate">withdrawn</Badge> : <Badge tone="green">active</Badge>}
      </td>
      <td className="px-3 py-3 text-right">
        {withdrawn ? (
          <Button variant="ghost" onClick={onReinstate}>Reinstate</Button>
        ) : (
          <Button variant="ghost" className="text-amber-700" onClick={onWithdraw}>Withdraw</Button>
        )}
        <Button variant="ghost" className="text-red-700" onClick={onRemove}>Remove</Button>
      </td>
    </tr>
  );
}

// ── Withdraw modal ───────────────────────────────────────────────────────────
function WithdrawModal({
  academyId, member, curriculum, onClose,
}: {
  academyId: string; member: WithId<RosterMemberDoc>; curriculum: WithId<CurriculumDoc> | null; onClose: () => void;
}) {
  const [afterCourse, setAfterCourse] = useState('');
  const [busy, setBusy] = useState(false);
  const tested = (curriculum?.courses ?? []).filter((c) => c.tested);

  async function submit() {
    setBusy(true);
    await updateDoc(doc(db, 'academies', academyId, 'roster', member.id), {
      status: 'withdrawn',
      withdrawnAt: serverTimestamp(),
      ...(afterCourse ? { withdrawnAfterCourse: afterCourse } : {}),
      updatedAt: serverTimestamp(),
    });
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Withdraw ${member.fullName}`}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          They stay on the roster (clearly marked withdrawn) so the record is kept. Their grades up to the
          withdrawal point are retained; everything after reads WD.
        </p>
        <Field label="Withdrawn after which course? (optional)" hint="Grades for courses after this one show WD.">
          <Select value={afterCourse} onChange={(e) => setAfterCourse(e.target.value)}>
            <option value="">— not specified —</option>
            {tested.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={submit} disabled={busy}>{busy ? 'Withdrawing…' : 'Withdraw'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Tiered intake wizard ─────────────────────────────────────────────────────
interface Draft {
  fullName: string; agency: RosterAgency; agencyOther: string;
  cjis: string; studentId: string; phone: string; email: string;
  emergencyName: string; emergencyPhone: string;
}
const BLANK: Draft = {
  fullName: '', agency: 'PSO', agencyOther: '', cjis: '', studentId: '', phone: '', email: '',
  emergencyName: '', emergencyPhone: '',
};

function IntakeWizard({ academyId, onClose }: { academyId: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // One field per step (the agency step has a conditional "other" box).
  const steps: { label: string; hint?: string; valid: () => boolean; render: () => React.ReactNode }[] = [
    {
      label: 'Full name', valid: () => draft.fullName.trim().length > 1,
      render: () => <Input autoFocus value={draft.fullName} onChange={(e) => set({ fullName: e.target.value })} placeholder="First Last" />,
    },
    {
      label: 'Sponsoring agency', valid: () => draft.agency !== 'Other' || draft.agencyOther.trim().length > 0,
      render: () => (
        <div className="space-y-2">
          <Select autoFocus value={draft.agency} onChange={(e) => set({ agency: e.target.value as RosterAgency })}>
            {ROSTER_AGENCIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </Select>
          {draft.agency === 'Other' && (
            <Input value={draft.agencyOther} onChange={(e) => set({ agencyOther: e.target.value })} placeholder="Agency name" />
          )}
        </div>
      ),
    },
    { label: 'CJIS number', hint: 'Optional', valid: () => true, render: () => <Input autoFocus value={draft.cjis} onChange={(e) => set({ cjis: e.target.value })} /> },
    { label: 'Student ID', hint: 'Optional', valid: () => true, render: () => <Input autoFocus value={draft.studentId} onChange={(e) => set({ studentId: e.target.value })} placeholder="P00000000" /> },
    { label: 'Phone number', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} /> },
    { label: 'Email address', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} /> },
    { label: 'Emergency contact — name', hint: 'Optional', valid: () => true, render: () => <Input autoFocus value={draft.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /> },
    { label: 'Emergency contact — phone', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="tel" value={draft.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /> },
  ];

  const isLast = step === steps.length - 1;
  const cur = steps[step];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await rosterCreateMember({
        academyId,
        member: {
          fullName: draft.fullName, agency: draft.agency, agencyOther: draft.agencyOther,
          cjis: draft.cjis, studentId: draft.studentId, phone: draft.phone, email: draft.email,
          emergencyName: draft.emergencyName, emergencyPhone: draft.emergencyPhone,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the member.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add cadet to roster">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-watch-100">
            <div className="h-full bg-bifrost-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <span className="text-xs text-slate-400">{step + 1} / {steps.length}</span>
        </div>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        <form
          onSubmit={(e) => { e.preventDefault(); if (!cur.valid()) return; isLast ? save() : setStep((s) => s + 1); }}
        >
          <Field label={cur.label} hint={cur.hint}>{cur.render()}</Field>
          <div className="mt-5 flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)} disabled={busy}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            <Button type="submit" variant="primary" disabled={!cur.valid() || busy}>
              {busy ? 'Saving…' : isLast ? 'Add to roster' : 'Next'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
