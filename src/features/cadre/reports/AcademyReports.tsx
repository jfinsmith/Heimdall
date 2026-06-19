/**
 * Reports for a single academy — report-type cards, the filed-reports list, and
 * the fill/edit form. Shared by the standalone Cadet Reports page and the Roster
 * module's Reports tab. Report types are discipline-scoped (LE only for now).
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, deleteDoc, doc, limit, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import type { AcademyDoc, AcademyReportDoc, CurriculumDoc, RosterMemberDoc, UserDoc } from '../../../types';
import { FDLE_LE_COURSES } from '../../../types';
import { Button, Field, Input, Select, TextArea } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { getReportType, REPORT_TYPES, type ReportType } from './reportTypes';
import { offeredLetterForms, libraryFormToReportType, useOrgLibraryForms } from './documentLibrary';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function AcademyReports({ academy }: { academy: WithId<AcademyDoc> }) {
  const { profile } = useAuth();
  const academyId = academy.id;
  // Org-scoped in useCollection; sorted client-side (no orderBy → single-field index).
  const { data: rosterRaw } = useCollection<RosterMemberDoc>(`academies/${academyId}/roster`, [], [academyId]);
  const roster = useMemo(() => [...rosterRaw].sort((a, b) => (a.no ?? 0) - (b.no ?? 0)), [rosterRaw]);
  const { data: reportsRaw, error: reportsError } = useCollection<AcademyReportDoc>(`academies/${academyId}/reports`, [], [academyId]);
  const reports = useMemo(
    () => [...reportsRaw].sort((a, b) => ((b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0) - ((a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0)),
    [reportsRaw]
  );
  const { data: directors } = useCollection<UserDoc>('users', [where('role', '==', 'director'), limit(1)]);
  const directorName = directors[0]?.displayName ?? 'Academy Director';
  const { data: curriculum } = useDoc<CurriculumDoc>(academy.discipline ? `curricula/${academy.discipline}` : null);

  const [formType, setFormType] = useState<ReportType | null>(null);
  const [editing, setEditing] = useState<WithId<AcademyReportDoc> | null>(null);

  // Forms offered to this class = built-in GENERAL code forms + the owner library's
  // general forms, with this discipline's overrides applied (disable / swap with a
  // specialized form / add a specialized form). Categories are gone.
  const { forms: libraryForms } = useOrgLibraryForms();
  const availableTypes = useMemo(
    () => offeredLetterForms(curriculum, REPORT_TYPES, libraryForms),
    [curriculum, libraryForms]
  );
  const libById = useMemo(() => new Map(libraryForms.map((f) => [f.id, f])), [libraryForms]);
  // Resolve a filed report's type by id (offered set → code registry → library).
  const typeFor = (id: string): ReportType | undefined => {
    const offered = availableTypes.find((t) => t.id === id);
    if (offered) return offered;
    const code = getReportType(id);
    if (code) return code;
    const lib = libById.get(id);
    return lib ? libraryFormToReportType(lib) : undefined;
  };

  async function remove(r: WithId<AcademyReportDoc>) {
    if (!window.confirm(`Delete this ${typeFor(r.type)?.name ?? 'report'} report for ${r.cadetName}?`)) return;
    await deleteDoc(doc(db, 'academies', academyId, 'reports', r.id));
  }

  return (
    <div>
      {availableTypes.length > 0 ? (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">New document</h2>
          <p className="mb-2 -mt-1 text-xs text-slate-500">
            Forms available to this class. <span className="font-medium text-amber-700">Some wording is draft — pending your legal review.</span>
          </p>
          <div className="mb-6 grid gap-3 md:grid-cols-2">
            {availableTypes.map((t) => (
              <ReportTypeCard key={t.id} type={t} onPick={() => { setEditing(null); setFormType(t); }} />
            ))}
          </div>
        </>
      ) : (
        <p className="mb-6 rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
          No forms are enabled for this discipline. Manage the document library under <strong>Owner → Report Forms</strong>,
          or adjust this discipline's forms under <strong>Admin → Curriculum &amp; Hours</strong>.
        </p>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Filed reports ({reports.length})</h2>
      {reportsError && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          Couldn’t load filed reports (a permission error). If a report was saved to the database but isn’t
          listed here, an org-stamp repair is needed — re-run the backfill or contact the platform owner.
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-4 py-3">Report</th>
              <th className="px-4 py-3">Cadet</th>
              <th className="px-4 py-3">Filed</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {reports.map((r) => (
              <tr key={r.id} className="hover:bg-watch-50/50">
                <td className="px-4 py-3 font-medium text-watch-900">{typeFor(r.type)?.name ?? r.type}</td>
                <td className="px-4 py-3">{r.cadetName}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {r.createdAt?.toDate?.().toLocaleDateString()} {r.createdByName ? `· ${r.createdByName}` : ''}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/cadet-reports/print/${academyId}/${r.id}`} target="_blank" rel="noopener" className="mr-3 text-sm text-bifrost-700 hover:underline">
                    Print ↗
                  </Link>
                  <Button variant="ghost" onClick={() => { const t = typeFor(r.type); if (t) { setEditing(r); setFormType(t); } }}>Edit</Button>
                  <Button variant="ghost" className="text-red-700" onClick={() => remove(r)}>Delete</Button>
                </td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No reports filed for this class yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {formType && (
        <ReportFormModal
          type={formType}
          academy={academy}
          roster={roster}
          editing={editing}
          fromName={profile?.displayName ?? ''}
          directorName={directorName}
          onClose={() => { setFormType(null); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ReportTypeCard({ type, onPick }: { type: ReportType; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="rounded-lg border border-watch-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-bifrost-300 hover:bg-bifrost-50/30"
    >
      <div className="font-semibold text-watch-900">{type.name}</div>
      <div className="mt-1 text-xs text-slate-500">{type.purpose}</div>
    </button>
  );
}

function ReportFormModal({
  type, academy, roster, editing, fromName, directorName, onClose,
}: {
  type: ReportType;
  academy: WithId<AcademyDoc>;
  roster: WithId<RosterMemberDoc>[];
  editing: WithId<AcademyReportDoc> | null;
  fromName: string;
  directorName: string;
  onClose: () => void;
}) {
  const { firebaseUser } = useAuth();
  // 'cadet' docs address a cadet (To: line); 'file'/'general' docs capture the
  // subject in their own fields. Academic letters (no document) are cadet-addressed.
  const appliesTo = type.document?.appliesTo ?? 'cadet';
  const [cadetId, setCadetId] = useState(editing?.cadetId ?? '');
  const [cadetName, setCadetName] = useState(editing?.cadetName ?? '');
  const [memoDate, setMemoDate] = useState(editing?.data._memoDate ?? today());
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = { ...(editing?.data ?? {}) };
    for (const f of type.fields) {
      if (init[f.key] !== undefined) continue;
      init[f.key] = f.defaultFrom === 'className' ? academy.shortName ?? '' : f.default ?? '';
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const missing =
    (appliesTo === 'cadet' && !cadetName.trim()) || type.fields.some((f) => f.required && !values[f.key]?.trim());

  function pickCadet(id: string) {
    setCadetId(id);
    const m = roster.find((x) => x.id === id);
    if (m) setCadetName(m.fullName);
  }

  // The label stored on the report (filed-reports "Cadet/Subject" column). For a
  // cadet-addressed doc that's the cadet; otherwise the best available subject field.
  function recordLabel(): string {
    if (appliesTo === 'cadet') return cadetName.trim();
    const cadetField = type.fields.find((f) => f.type === 'cadet');
    return (
      (cadetField && values[cadetField.key]?.trim()) ||
      values.recipient?.trim() ||
      values.personsInvolved?.trim() ||
      values.subject?.trim() ||
      '—'
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: type.id,
        ...(appliesTo === 'cadet' && cadetId ? { cadetId } : {}),
        cadetName: recordLabel(),
        data: { ...values, _memoDate: memoDate },
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'academies', academy.id, 'reports', editing.id), payload);
      } else {
        await addDoc(collection(db, 'academies', academy.id, 'reports'), {
          ...payload,
          orgId: academy.orgId,
          createdBy: firebaseUser!.uid,
          createdByName: fromName,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the report.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${editing ? 'Edit' : 'New'} — ${type.name}`} wide>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        {type.document && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Draft wording — pending legal review. Bracketed items like “[Academy Cadet Manual §___]” are placeholders to replace during your legal pass.
          </div>
        )}
        <div className="rounded-md bg-watch-50 px-3 py-2 text-xs text-slate-500">
          {appliesTo === 'cadet' && <>To: <strong>{cadetName || '—'}</strong> · </>}From: {fromName || '—'} · CC: Director {directorName}, Academy Director · {type.name}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {appliesTo === 'cadet' && (
            <>
              <Field label="Cadet (from roster)">
                <Select value={cadetId} onChange={(e) => pickCadet(e.target.value)}>
                  <option value="">— select / type name —</option>
                  {roster.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </Select>
              </Field>
              <Field label="Cadet name (To)">
                <Input value={cadetName} onChange={(e) => { setCadetName(e.target.value); setCadetId(''); }} required />
              </Field>
            </>
          )}
          <Field label="Memo date">
            <Input type="date" value={memoDate} onChange={(e) => setMemoDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {type.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              {f.type === 'course' ? (
                <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">— select course —</option>
                  {FDLE_LE_COURSES.map((c) => (
                    <option key={c.code} value={`${c.code} ${c.name}`}>{c.code} {c.name}</option>
                  ))}
                </Select>
              ) : f.type === 'cadet' ? (
                <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">— select cadet —</option>
                  {roster.map((m) => <option key={m.id} value={m.fullName}>{m.fullName}</option>)}
                </Select>
              ) : f.type === 'select' ? (
                <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">— select —</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : f.type === 'textarea' ? (
                <TextArea value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} rows={4} />
              ) : (
                <Input
                  type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || missing}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
