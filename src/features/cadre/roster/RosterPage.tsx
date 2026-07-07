/**
 * Academy Roster — per-academy cadet roster and the systems that hang off it:
 * a tiered intake wizard, the Members list, the
 * printable Attendance Roster, the Discipline tracker, and the Gradebook.
 * Real academies only — templates have no roster.
 */
import React, { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, updateDoc, deleteDoc, deleteField, collection, getDocs, query, where } from 'firebase/firestore';
import { db, functions } from '../../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import type { AcademyDoc, CurriculumDoc, RosterAgency, RosterMemberDoc } from '../../../types';
import { ROSTER_AGENCIES } from '../../../types';
import { Badge, Button, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { agencyLabel, courseKey, lastFirst, memberStanding, rosterCompare } from './rosterShared';
import { buildCadetRecords } from './exportRecords';
import { downloadCsv } from '../../../lib/csv';
import { BulkImportModal, type ImportColumn } from '../../../components/BulkImportModal';
import { AttendanceTab } from './AttendanceTab';
import { AttendanceLogTab } from './AttendanceLogTab';
import { DisciplineTab } from './DisciplineTab';
import { GradesTab } from './GradesTab';
import { AcademyReports, type LetterSeed } from '../reports/AcademyReports';
import { enabledRosterModules, ROSTER_MODULE_BY_KEY } from './rosterModules';
import { formatPhone } from '../../../lib/format';
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
  // Canonical order for EVERY roster tab: alphabetical by last name, with
  // withdrawn/dismissed members sinking to the bottom. A newly added cadet
  // slots straight into place; `no` remains a stable intake-order identifier.
  const members = useMemo(() => [...membersRaw].sort(rosterCompare), [membersRaw]);
  const { data: curriculum } = useCurriculum(academy?.discipline);
  const [tab, setTab] = useState<Tab>('members');
  // "Generate letter" from grades/discipline → jump to Reports with a pre-fill.
  const [letterSeed, setLetterSeed] = useState<LetterSeed | null>(null);
  const generateLetter = (s: LetterSeed) => { setLetterSeed(s); setTab('reports'); };

  // Records export (item 10): one CSV row per cadet — identity, outcome, standing,
  // attended hours (summed from the attendance subcollection), per-course results.
  async function exportRecords() {
    // The attendance list rule is inOrg(resource.data) — the query MUST carry the
    // orgId filter or Firestore denies it outright (raw getDocs gets no
    // auto-injection, unlike useCollection).
    if (!academy?.orgId) { window.alert('This academy is missing its organization — export unavailable.'); return; }
    const snap = await getDocs(
      query(collection(db, 'academies', academyId, 'attendance'), where('orgId', '==', academy.orgId))
    ).catch(() => null);
    if (!snap) { window.alert('Couldn’t read the attendance log — try again in a moment.'); return; }
    const attendedHours = new Map<string, number>();
    snap.forEach((d) => {
      const entries = (d.data() as { entries?: Record<string, { hours?: number }> }).entries ?? {};
      for (const [cid, e] of Object.entries(entries)) {
        if (e?.hours) attendedHours.set(cid, (attendedHours.get(cid) ?? 0) + e.hours);
      }
    });
    const { headers, rows } = buildCadetRecords(members, curriculum?.courses ?? [], attendedHours);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`${academy?.shortName || academy?.name || 'academy'}-records-${stamp}`, headers, rows);
  }

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

  const active = members.filter((m) => m.status === 'active' && !m.blockTaker);
  const graduated = members.filter((m) => m.status === 'graduated');
  const withdrawn = members.filter((m) => m.status === 'withdrawn');
  const dismissed = members.filter((m) => m.status === 'dismissed');

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
            <div className="flex items-center gap-3">
              <button type="button" onClick={exportRecords} className="text-sm text-bifrost-700 hover:underline">⬇ Export records</button>
              <Link to={`/cadre/academies/${academyId}`} className="text-sm text-bifrost-700 hover:underline">
                ← Back to builder
              </Link>
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="green">{active.length} active</Badge>
          {graduated.length > 0 && <Badge tone="navy">{graduated.length} graduated</Badge>}
          {withdrawn.length > 0 && <Badge tone="slate">{withdrawn.length} withdrawn</Badge>}
          {dismissed.length > 0 && <Badge tone="red">{dismissed.length} dismissed</Badge>}
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
      {activeTab === 'attendance_log' && <AttendanceLogTab academyId={academyId} members={members} />}
      {activeTab === 'discipline' && <DisciplineTab academyId={academyId} members={members} onGenerateLetter={generateLetter} />}
      {activeTab === 'grades' && <GradesTab academyId={academyId} members={members} curriculum={curriculum} onGenerateLetter={generateLetter} />}
      {activeTab === 'reports' && <AcademyReports academy={academy} seed={letterSeed} onSeedConsumed={() => setLetterSeed(null)} />}
    </div>
  );
}

// ── Members tab ──────────────────────────────────────────────────────────────
const CADET_IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'fullName', label: 'Name', required: true, aliases: ['full name', 'cadet', 'cadet name'] },
  { key: 'agency', label: 'Agency', aliases: ['dept', 'department'] },
  { key: 'cjis', label: 'CJIS', aliases: ['cjis id', 'cjis number'] },
  { key: 'studentId', label: 'Student ID', aliases: ['student', 'sid'] },
  { key: 'dob', label: 'DOB', aliases: ['date of birth', 'birthdate', 'birth date'] },
  { key: 'email', label: 'Email', aliases: ['e-mail'] },
  { key: 'phone', label: 'Phone', aliases: ['phone number', 'cell'] },
];

/** Normalize a CSV date-of-birth to yyyy-mm-dd. Already-ISO strings pass through
 *  untouched (parsing them would shift a day in UTC); US formats parse locally. */
function normalizeDob(raw?: string): string | null {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validateCadetRow(r: Record<string, string>): string[] {
  const errs: string[] = [];
  if (!r.fullName?.trim()) errs.push('Name required');
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) errs.push('Bad email');
  if (normalizeDob(r.dob) === null) errs.push('Bad DOB');
  return errs;
}

/** Map a CSV row to a rosterCreateMember payload. An unrecognized agency name is
 *  preserved as agencyOther under the 'Other' bucket (matches the intake wizard). */
function toCadetMember(r: Record<string, string>): Record<string, unknown> {
  const raw = (r.agency ?? '').trim();
  const match = ROSTER_AGENCIES.find((a) => a.key.toLowerCase() === raw.toLowerCase() || a.label.toLowerCase() === raw.toLowerCase());
  return {
    fullName: r.fullName.trim(),
    agency: match?.key ?? (raw ? 'Other' : 'PSO'),
    ...(match || !raw ? {} : { agencyOther: raw }),
    ...(r.cjis ? { cjis: r.cjis } : {}),
    ...(r.studentId ? { studentId: r.studentId } : {}),
    ...(normalizeDob(r.dob) ? { dob: normalizeDob(r.dob) } : {}),
    ...(r.email ? { email: r.email } : {}),
    ...(r.phone ? { phone: r.phone } : {}),
  };
}

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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<WithId<RosterMemberDoc> | null>(null);
  const [editTarget, setEditTarget] = useState<WithId<RosterMemberDoc> | null>(null);
  const [emergencyTarget, setEmergencyTarget] = useState<WithId<RosterMemberDoc> | null>(null);

  async function remove(m: WithId<RosterMemberDoc>) {
    if (!window.confirm(`Remove ${m.fullName} from the roster entirely? To keep a record, withdraw them instead.`)) return;
    await deleteDoc(doc(db, 'academies', academyId, 'roster', m.id));
  }
  async function reinstate(m: WithId<RosterMemberDoc>) {
    await updateDoc(doc(db, 'academies', academyId, 'roster', m.id), {
      status: 'active', completedAt: deleteField(), dismissalReason: deleteField(), updatedAt: serverTimestamp(),
    });
  }
  async function graduate(m: WithId<RosterMemberDoc>) {
    const standing = memberStanding(m, curriculum?.courses ?? []);
    const fails = standing.hlFails + standing.nonHlFails;
    const warn = fails > 0 ? `\n\nNote: ${fails} unresolved course failure(s) on record. Graduation is NOT blocked — verify before issuing the certificate.` : '';
    if (!window.confirm(`Mark ${m.fullName} as GRADUATED? Their Certificate of Completion becomes available.${warn}`)) return;
    await updateDoc(doc(db, 'academies', academyId, 'roster', m.id), { status: 'graduated', completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  async function dismiss(m: WithId<RosterMemberDoc>) {
    const reason = window.prompt(`Reason for dismissing ${m.fullName}? (kept on the record)`);
    if (reason == null) return; // cancelled
    await updateDoc(doc(db, 'academies', academyId, 'roster', m.id), {
      status: 'dismissed', completedAt: serverTimestamp(), ...(reason.trim() ? { dismissalReason: reason.trim() } : {}), updatedAt: serverTimestamp(),
    });
  }

  const full = members.filter((m) => !m.blockTaker);
  const blockTakers = members.filter((m) => m.blockTaker);

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setBulkOpen(true)}>Bulk import</Button>
        <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add member</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Agency</th>
              <th className="px-3 py-3">CJIS</th>
              <th className="px-3 py-3">Student ID</th>
              <th className="px-3 py-3">DOB</th>
              <th className="px-3 py-3">Contact</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {/* # is the LIVE position in the roster, not a stored id — so removing a
                member collapses the numbers below them (e.g. pull #23 → #24 becomes #23). */}
            {full.map((m, i) => (
              <MemberRow key={m.id} m={m} displayNo={i + 1} academyId={academyId}
                onWithdraw={() => setWithdrawTarget(m)} onReinstate={() => reinstate(m)} onRemove={() => remove(m)}
                onEdit={() => setEditTarget(m)} onEmergency={() => setEmergencyTarget(m)}
                onGraduate={() => graduate(m)} onDismiss={() => dismiss(m)} />
            ))}
            {full.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">No members yet — add the first cadet.</td></tr>
            )}
          </tbody>
          {blockTakers.length > 0 && (
            <tbody className="divide-y divide-watch-50">
              <tr className="bg-watch-100/60"><td colSpan={8} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-watch-600">Additional block takers</td></tr>
              {blockTakers.map((m, i) => (
                <MemberRow key={m.id} m={m} displayNo={i + 1} academyId={academyId}
                  onWithdraw={() => setWithdrawTarget(m)} onReinstate={() => reinstate(m)} onRemove={() => remove(m)}
                  onEdit={() => setEditTarget(m)} onEmergency={() => setEmergencyTarget(m)}
                  onGraduate={() => graduate(m)} onDismiss={() => dismiss(m)} />
              ))}
            </tbody>
          )}
        </table>
      </div>

      {addOpen && <IntakeWizard academyId={academyId} onClose={() => setAddOpen(false)} />}
      {bulkOpen && (
        <BulkImportModal
          title="Bulk import cadets"
          columns={CADET_IMPORT_COLUMNS}
          exampleRow="Jane Cadet,PSO,FL0512345,S-1042,03/05/2001,jane@example.com,727-555-0142"
          rowLabel={(r) => r.fullName || '—'}
          validateRow={validateCadetRow}
          importRow={async (r) => { await rosterCreateMember({ academyId, member: toCadetMember(r) }); }}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {withdrawTarget && (
        <WithdrawModal academyId={academyId} member={withdrawTarget} curriculum={curriculum} onClose={() => setWithdrawTarget(null)} />
      )}
      {editTarget && <EditMemberModal academyId={academyId} member={editTarget} onClose={() => setEditTarget(null)} />}
      {emergencyTarget && <EmergencyModal member={emergencyTarget} onClose={() => setEmergencyTarget(null)} />}
    </div>
  );
}

function MemberRow({
  m, displayNo, academyId, onWithdraw, onReinstate, onRemove, onEdit, onEmergency, onGraduate, onDismiss,
}: {
  m: WithId<RosterMemberDoc>;
  displayNo: number;
  academyId: string;
  onWithdraw: () => void; onReinstate: () => void; onRemove: () => void;
  onEdit: () => void; onEmergency: () => void; onGraduate: () => void; onDismiss: () => void;
}) {
  const dim = m.status === 'withdrawn' || m.status === 'dismissed';
  const hasEmergency = !!(m.emergencyName?.trim() || m.emergencyPhone?.trim());
  const statusBadge =
    m.status === 'graduated' ? <Badge tone="navy">graduated</Badge>
    : m.status === 'dismissed' ? <Badge tone="red">dismissed</Badge>
    : m.status === 'withdrawn' ? <Badge tone="slate">withdrawn</Badge>
    : <Badge tone="green">active</Badge>;
  return (
    <tr className={dim ? 'bg-slate-50 text-slate-400' : ''}>
      <td className="px-3 py-3 tabular-nums">{displayNo}</td>
      <td className="px-3 py-3 font-medium text-watch-900">
        <span className={dim ? 'line-through' : ''}>{lastFirst(m.fullName)}</span>
      </td>
      <td className="px-3 py-3">{agencyLabel(m)}</td>
      <td className="px-3 py-3 text-xs text-slate-500">{m.cjis || '—'}</td>
      <td className="px-3 py-3 text-xs text-slate-500">{m.studentId || '—'}</td>
      <td className="px-3 py-3 text-xs tabular-nums text-slate-500">{m.dob ? new Date(`${m.dob}T12:00:00`).toLocaleDateString() : '—'}</td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {m.email && <div>{m.email}</div>}
        {m.phone && <div>{formatPhone(m.phone)}</div>}
        {!m.email && !m.phone && '—'}
      </td>
      <td className="px-3 py-3">{statusBadge}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <Button variant="ghost" onClick={onEmergency} disabled={!hasEmergency} title={hasEmergency ? 'View emergency contact' : 'No emergency contact on file'}>Emergency</Button>
        <Button variant="ghost" className="text-bifrost-700" onClick={onEdit}>Edit</Button>
        <Link to={`/roster/cadet/print/${academyId}/${m.id}`} target="_blank" rel="noopener" className="inline-block px-2 text-sm text-bifrost-700 hover:underline">Certificate</Link>
        {m.status === 'active' ? (
          <>
            <Button variant="ghost" className="text-green-700" onClick={onGraduate}>Graduate</Button>
            <Button variant="ghost" className="text-amber-700" onClick={onWithdraw}>Withdraw</Button>
            <Button variant="ghost" className="text-red-700" onClick={onDismiss}>Dismiss</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onReinstate}>Reinstate</Button>
        )}
        <Button variant="ghost" className="text-red-700" onClick={onRemove}>Remove</Button>
      </td>
    </tr>
  );
}

// ── Emergency-contact popup ──────────────────────────────────────────────────
function EmergencyModal({ member, onClose }: { member: WithId<RosterMemberDoc>; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Emergency contact — ${member.fullName}`}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Name</div>
          <div className="text-watch-900">{member.emergencyName?.trim() || '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Phone</div>
          <div className="text-watch-900">{member.emergencyPhone?.trim() ? formatPhone(member.emergencyPhone) : '—'}</div>
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit member ──────────────────────────────────────────────────────────────
function EditMemberModal({
  academyId, member, onClose,
}: {
  academyId: string; member: WithId<RosterMemberDoc>; onClose: () => void;
}) {
  const [fullName, setFullName] = useState(member.fullName ?? '');
  const [agency, setAgency] = useState<RosterAgency>((member.agency as RosterAgency) ?? 'PSO');
  const [agencyOther, setAgencyOther] = useState(member.agencyOther ?? '');
  const [cjis, setCjis] = useState(member.cjis ?? '');
  const [studentId, setStudentId] = useState(member.studentId ?? '');
  const [dob, setDob] = useState(member.dob ?? '');
  const [phone, setPhone] = useState(member.phone ?? '');
  const [email, setEmail] = useState(member.email ?? '');
  const [emergencyName, setEmergencyName] = useState(member.emergencyName ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(member.emergencyPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setError('A full name is required.'); return; }
    if (agency === 'Other' && !agencyOther.trim()) { setError('Enter the agency name.'); return; }
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'academies', academyId, 'roster', member.id), {
        fullName: fullName.trim(),
        agency,
        agencyOther: agency === 'Other' ? agencyOther.trim() : '',
        cjis: cjis.trim(),
        studentId: studentId.trim(),
        ...(dob ? { dob } : { dob: deleteField() }),
        phone: formatPhone(phone),
        email: email.trim(),
        emergencyName: emergencyName.trim(),
        emergencyPhone: formatPhone(emergencyPhone),
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit — ${member.fullName}`}>
      <form onSubmit={save} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <Field label="Full name">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="First Last" />
        </Field>
        <Field label="Sponsoring agency">
          <Select value={agency} onChange={(e) => setAgency(e.target.value as RosterAgency)}>
            {ROSTER_AGENCIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </Select>
          {agency === 'Other' && (
            <Input className="mt-2" value={agencyOther} onChange={(e) => setAgencyOther(e.target.value)} placeholder="Agency name" />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CJIS number"><Input value={cjis} onChange={(e) => setCjis(e.target.value)} /></Field>
          <Field label="Student ID"><Input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="P00000000" /></Field>
          <Field label="Date of birth"><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
          <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Emergency contact — name"><Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} /></Field>
          <Field label="Emergency contact — phone"><Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} onBlur={() => setEmergencyPhone(formatPhone(emergencyPhone))} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
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
            {tested.map((c) => <option key={courseKey(c)} value={courseKey(c)}>{c.name}</option>)}
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
  cjis: string; studentId: string; dob: string; phone: string; email: string;
  emergencyName: string; emergencyPhone: string;
}
const BLANK: Draft = {
  fullName: '', agency: 'PSO', agencyOther: '', cjis: '', studentId: '', dob: '', phone: '', email: '',
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
    { label: 'Date of birth', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="date" value={draft.dob} onChange={(e) => set({ dob: e.target.value })} /> },
    { label: 'Phone number', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={() => set({ phone: formatPhone(draft.phone) })} /> },
    { label: 'Email address', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} /> },
    { label: 'Emergency contact — name', hint: 'Optional', valid: () => true, render: () => <Input autoFocus value={draft.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /> },
    { label: 'Emergency contact — phone', hint: 'Optional', valid: () => true, render: () => <Input autoFocus type="tel" value={draft.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} onBlur={() => set({ emergencyPhone: formatPhone(draft.emergencyPhone) })} /> },
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
          cjis: draft.cjis, studentId: draft.studentId, dob: draft.dob, phone: formatPhone(draft.phone), email: draft.email,
          emergencyName: draft.emergencyName, emergencyPhone: formatPhone(draft.emergencyPhone),
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
