/**
 * Admin — Curriculum & Hours: the editable list of disciplines, each with its
 * course blocks and FDLE minimum hours. The discipline's default target hours
 * is always the sum of its course hours; academies pick a discipline at
 * creation and the builder tracks per-course coverage against these minimums.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { CurriculumCourse, CurriculumDoc, QualificationKey, RosterModuleKey } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';
import { ROSTER_MODULES, DEFAULT_ROSTER_MODULES } from '../cadre/roster/rosterModules';
import { REPORT_TYPES } from '../cadre/reports/reportTypes';
import { useOrgLibraryForms } from '../cadre/reports/documentLibrary';
import { FDLE_DEFAULT_CURRICULA } from './fdleCurricula';

const ownerListOrgs = httpsCallable<void, { orgs: { orgId: string; legalName: string }[] }>(functions, 'ownerListOrgs');
const importDefaultCurricula = httpsCallable<{ sourceOrgId: string }, { ok: boolean; count: number }>(functions, 'importDefaultCurricula');

/**
 * Curriculum & Hours editor. scope='org' edits the active org's curricula;
 * scope='defaults' (owner only) edits the platform DEFAULT templates that every
 * new organization is seeded from.
 */
export function CurriculumAdminPage({ scope = 'org' }: { scope?: 'org' | 'defaults' }) {
  const { firebaseUser } = useAuth();
  const isDefaults = scope === 'defaults';
  const coll = isDefaults ? 'defaultCurricula' : 'curricula';
  const { data: curricula } = useCollection<CurriculumDoc>(coll);
  const [editing, setEditing] = useState<WithId<CurriculumDoc> | 'new' | null>(null);

  async function toggleActive(c: WithId<CurriculumDoc>) {
    await setDoc(doc(db, coll, c.id), { active: !c.active }, { merge: true });
  }

  async function remove(c: WithId<CurriculumDoc>) {
    if (!window.confirm(`Delete the "${c.label}" discipline?${isDefaults ? '' : ' Existing academies keep their data; new academies can no longer pick it.'}`)) return;
    await deleteDoc(doc(db, coll, c.id));
    if (!isDefaults) await logAudit(firebaseUser!.uid, 'curriculum.delete', 'curriculum', c.id, c.label);
  }

  return (
    <div>
      <PageHeader
        kicker={isDefaults ? 'Platform Owner' : 'Admin'}
        title={isDefaults ? 'Default Curricula (new organizations)' : 'Curriculum & Hours'}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New discipline
          </Button>
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {isDefaults
          ? 'These templates seed every NEW organization’s curricula automatically (with org-namespaced ids, so tenants never collide). Edit them here, or import a starting set from an existing organization below. FDLE high-liability courses (Firearms, Defensive Tactics, Vehicle Operations, First Aid) get their recommended instructor ratios applied on import.'
          : "Each discipline's full course list lives here — the course name, required hours, whether it's high-liability (▲), and the qualification a lead instructor must hold. This is the single source for the builder's course picker and curriculum coverage. Editing changes defaults for new academies — existing academies aren't modified."}
      </p>
      {isDefaults && <ImportDefaults />}

      <div className="grid gap-4 lg:grid-cols-2">
        {[...curricula]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((c) => (
            <section key={c.id} className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-watch-900">{c.label}</h2>
                  <div className="text-xs text-slate-500">{c.fdleProgram}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.estimated && <Badge tone="amber">estimated hours</Badge>}
                  <Badge tone={c.active ? 'green' : 'slate'}>{c.active ? 'active' : 'inactive'}</Badge>
                </div>
              </div>
              <div className="mb-2 text-sm text-watch-800">
                <strong>{c.totalHours}</strong> total hours · {c.courses.length} course blocks
              </div>
              <ul className="mb-3 max-h-44 space-y-0.5 overflow-y-auto pr-1 text-sm">
                {c.courses.map((course) => (
                  <li key={course.name} className="flex justify-between gap-2">
                    <span className="truncate text-slate-600">
                      {course.cjk && <span className="mr-1 font-mono text-xs text-slate-400">{course.cjk}</span>}
                      {course.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">{course.minHours} hrs</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(c)}>Edit</Button>
                <Button variant="ghost" onClick={() => toggleActive(c)}>
                  {c.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="ghost" onClick={() => remove(c)}>
                  Delete
                </Button>
              </div>
            </section>
          ))}
      </div>

      {editing && (
        <CurriculumEditorModal
          scope={scope}
          curriculum={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Owner-only: seed the platform default curricula — from the built-in FDLE set
 *  (CJK + ratios baked in) or by copying an existing org's curricula. */
function ImportDefaults() {
  const [orgs, setOrgs] = useState<{ orgId: string; legalName: string }[]>([]);
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { ownerListOrgs().then((r) => setOrgs(r.data.orgs)).catch(() => setOrgs([])); }, []);

  async function loadFdle() {
    if (!window.confirm('Load the built-in FDLE standard curricula? This writes the Law Enforcement program (with CJK numbers + high-liability ratios) and shells for Corrections, EOT, and the two crossovers — overwriting any default of the same key. Per-course HOURS are estimates to verify.')) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const c of FDLE_DEFAULT_CURRICULA) {
        await setDoc(doc(db, 'defaultCurricula', c.key), c, { merge: false });
      }
      setMsg(`Loaded ${FDLE_DEFAULT_CURRICULA.length} FDLE standard curricula. Verify/adjust hours, then they’ll seed every new org.`);
    } catch (e) {
      setMsg((e as Error).message || 'Load failed.');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!src) return;
    if (!window.confirm('Replace the default curricula with a copy of the selected organization’s curricula? (Existing organizations are not affected — only the templates new orgs are seeded from.)')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await importDefaultCurricula({ sourceOrgId: src });
      setMsg(`Imported ${r.data.count} curricula as new-org defaults.`);
    } catch (e) {
      setMsg((e as Error).message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 space-y-3 rounded-lg border border-watch-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy} onClick={loadFdle}>{busy ? 'Working…' : 'Load FDLE standard curricula'}</Button>
        <span className="text-xs text-slate-500">Recommended starting point — LE fully populated (CJK + ratios); Corrections/EOT/crossovers as shells to fill.</span>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-watch-50 pt-3">
        <Field label="…or import defaults from an organization" className="min-w-[16rem] flex-1">
          <Select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">Choose an organization…</option>
            {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.legalName}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" disabled={!src || busy} onClick={run}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
      {msg && <span className="block text-sm text-slate-600">{msg}</span>}
    </div>
  );
}

function CurriculumEditorModal({
  scope,
  curriculum,
  onClose,
}: {
  scope: 'org' | 'defaults';
  curriculum: WithId<CurriculumDoc> | null;
  onClose: () => void;
}) {
  const { firebaseUser, orgId } = useAuth();
  const isDefaults = scope === 'defaults';
  const coll = isDefaults ? 'defaultCurricula' : 'curricula';
  const [label, setLabel] = useState(curriculum?.label ?? '');
  const [fdleProgram, setFdleProgram] = useState(curriculum?.fdleProgram ?? '');
  const [key, setKey] = useState(curriculum?.key ?? curriculum?.id ?? '');
  const [courses, setCourses] = useState<CurriculumCourse[]>(curriculum?.courses ?? [{ name: '', minHours: 0 }]);
  const [estimated, setEstimated] = useState(curriculum?.estimated ?? false);
  const [rosterModules, setRosterModules] = useState<RosterModuleKey[]>(curriculum?.rosterModules ?? DEFAULT_ROSTER_MODULES);
  // Branding overrides (org scope only) — each falls back to org settings if blank.
  const [brandLogoUrl, setBrandLogoUrl] = useState(curriculum?.brandLogoUrl ?? '');
  const [brandOrgName, setBrandOrgName] = useState(curriculum?.brandOrgName ?? '');
  const [brandTagline, setBrandTagline] = useState(curriculum?.brandTagline ?? '');
  const [brandAddress, setBrandAddress] = useState((curriculum?.brandAddressLines ?? []).join('\n'));
  const [uploading, setUploading] = useState(false);
  // Per-discipline document overrides.
  const [disabledForms, setDisabledForms] = useState<string[]>(curriculum?.disabledForms ?? []);
  const [formOverrides, setFormOverrides] = useState<Record<string, string>>(curriculum?.formOverrides ?? {});
  const [addedForms, setAddedForms] = useState<string[]>(curriculum?.addedForms ?? []);
  const { forms: libraryForms } = useOrgLibraryForms();
  const [busy, setBusy] = useState(false);

  // Base general forms (built-ins + library general letters) and the org's
  // assigned specialized letters available as overrides/additions for this discipline.
  const baseGeneral = useMemo(
    () => [
      ...REPORT_TYPES.map((t) => ({ id: t.id, name: t.name })),
      ...libraryForms.filter((f) => f.availability === 'general' && (f.kind ?? 'letter') === 'letter').map((f) => ({ id: f.id, name: f.name })),
    ],
    [libraryForms]
  );
  const specializedForms = useMemo(
    () => libraryForms.filter((f) => f.availability === 'specialized' && (f.kind ?? 'letter') === 'letter').map((f) => ({ id: f.id, name: f.name })),
    [libraryForms]
  );

  const total = courses.reduce((sum, c) => sum + (Number(c.minHours) || 0), 0);

  function updateCourse(i: number, patch: Partial<CurriculumCourse>) {
    setCourses((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  const toggleModule = (k: RosterModuleKey) =>
    setRosterModules((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleDisabled = (id: string) =>
    setDisabledForms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const setOverride = (baseId: string, specId: string) =>
    setFormOverrides((p) => {
      const n = { ...p };
      if (specId) n[baseId] = specId;
      else delete n[baseId];
      return n;
    });
  const toggleAdded = (id: string) =>
    setAddedForms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function uploadLogo(file: File) {
    if (!orgId) return;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const r = ref(storage, `branding/${orgId}/curriculum-${Date.now()}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      setBrandLogoUrl(await getDownloadURL(r));
    } catch {
      /* admin can paste a URL instead */
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDefaults && !orgId) {
      alert('Your account is still loading its organization — reload and try again.');
      return;
    }
    setBusy(true);
    // Base key (e.g. le_brt) vs. doc id. Org curricula get an org-namespaced doc
    // id ({orgId}__{key}) so two tenants can both have an 'le_brt' without colliding
    // on a shared global doc; existing bare-id curricula keep their id when edited.
    const baseKey = curriculum ? (curriculum.key || curriculum.id) : key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const id = curriculum ? curriculum.id : isDefaults ? baseKey : `${orgId}__${baseKey}`;
    const cleaned = courses.filter((c) => c.name.trim()).map((c) => ({
      name: c.name.trim(),
      minHours: Number(c.minHours) || 0,
      ...(c.cjk?.trim() ? { cjk: c.cjk.trim() } : {}),
      ...(c.highLiability ? { highLiability: true } : {}),
      ...(c.coordinatorRun ? { coordinatorRun: true } : {}),
      ...(c.tested ? { tested: true } : {}),
      ...(c.instructorRatio ? { instructorRatio: Number(c.instructorRatio) } : {}),
      ...(c.leadQualification && !c.coordinatorRun ? { leadQualification: c.leadQualification } : {}),
      ...(c.defaultRoleSlots && c.defaultRoleSlots.length ? { defaultRoleSlots: c.defaultRoleSlots } : {}),
    }));
    await setDoc(doc(db, coll, id), {
      ...(isDefaults ? {} : { orgId: orgId! }),
      key: baseKey,
      label,
      fdleProgram,
      courses: cleaned,
      totalHours: cleaned.reduce((s, c) => s + c.minHours, 0),
      active: curriculum?.active ?? true,
      estimated,
      rosterModules,
      ...(brandLogoUrl.trim() ? { brandLogoUrl: brandLogoUrl.trim() } : {}),
      ...(brandOrgName.trim() ? { brandOrgName: brandOrgName.trim() } : {}),
      ...(brandTagline.trim() ? { brandTagline: brandTagline.trim() } : {}),
      ...(brandAddress.trim() ? { brandAddressLines: brandAddress.split('\n').map((l) => l.trim()).filter(Boolean) } : {}),
      ...(disabledForms.length ? { disabledForms } : {}),
      ...(Object.keys(formOverrides).length ? { formOverrides } : {}),
      ...(addedForms.length ? { addedForms } : {}),
    } satisfies CurriculumDoc);
    if (!isDefaults) await logAudit(firebaseUser!.uid, 'curriculum.save', 'curriculum', id, `${label} (${total} hrs)`);
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={curriculum ? `Edit — ${curriculum.label}` : 'New discipline'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Discipline label" hint='Shown when creating academies, e.g. "Law Enforcement (Basic Recruit)"'>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label="FDLE program name" hint="Appears on print headers and reports">
            <Input value={fdleProgram} onChange={(e) => setFdleProgram(e.target.value)} required />
          </Field>
        </div>
        {!curriculum && (
          <Field label="Key" hint="Internal id, e.g. le_brt — cannot change later">
            <Input value={key} onChange={(e) => setKey(e.target.value)} required placeholder="le_brt" />
          </Field>
        )}

        <label className="flex items-start gap-2 rounded-md border border-watch-100 bg-watch-50/40 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={estimated}
            onChange={(e) => setEstimated(e.target.checked)}
          />
          <span>
            <span className="font-medium text-watch-800">Estimated hours</span>
            <span className="block text-xs text-slate-500">
              Flags the per-course hours as a best-guess split rather than published FDLE minimums (shows an
              amber “estimated hours” badge). Use when the program total is set but the per-topic breakdown isn't.
            </span>
          </span>
        </label>

        <fieldset className="rounded-md border border-watch-100 p-3">
          <legend className="px-1 text-sm font-medium text-watch-800">
            Course blocks &amp; minimum hours — total <strong>{total}</strong> hrs
          </legend>
          <div className="mb-1 grid grid-cols-[5.5rem_1fr_4rem_2rem_2.5rem_3.5rem_8.5rem_1.5rem] items-center gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span title="FDLE/CJSTC course number">CJK #</span>
            <span>Course</span>
            <span>Hours</span>
            <span title="High-liability">▲ HL</span>
            <span title="Has an end-of-course exam">Test</span>
            <span title="Students per instructor (FDLE ratio)">Ratio</span>
            <span>Lead / staffing</span>
            <span />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {courses.map((c, i) => (
              <div key={i} className="grid grid-cols-[5.5rem_1fr_4rem_2rem_2.5rem_3.5rem_8.5rem_1.5rem] items-center gap-2">
                <Input
                  value={c.cjk ?? ''}
                  placeholder="CJK0040"
                  aria-label={`Course ${i + 1} CJK number`}
                  onChange={(e) => updateCourse(i, { cjk: e.target.value })}
                />
                <Input
                  value={c.name}
                  placeholder="Course name"
                  aria-label={`Course ${i + 1} name`}
                  onChange={(e) => updateCourse(i, { name: e.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={c.minHours}
                  aria-label={`Course ${i + 1} hours`}
                  onChange={(e) => updateCourse(i, { minHours: Number(e.target.value) })}
                />
                <input
                  type="checkbox"
                  className="justify-self-center"
                  checked={!!c.highLiability}
                  aria-label={`Course ${i + 1} high-liability`}
                  onChange={(e) => updateCourse(i, { highLiability: e.target.checked })}
                />
                <input
                  type="checkbox"
                  className="justify-self-center"
                  checked={!!c.tested}
                  aria-label={`Course ${i + 1} has end-of-course exam`}
                  onChange={(e) => updateCourse(i, { tested: e.target.checked })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="—"
                  value={c.instructorRatio ?? ''}
                  aria-label={`Course ${i + 1} instructor ratio (students per instructor)`}
                  onChange={(e) => updateCourse(i, { instructorRatio: e.target.value ? Number(e.target.value) : undefined })}
                />
                <Select
                  value={c.coordinatorRun ? '__coord__' : c.leadQualification ?? ''}
                  aria-label={`Course ${i + 1} lead / staffing`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__coord__') updateCourse(i, { coordinatorRun: true, leadQualification: undefined });
                    else updateCourse(i, { coordinatorRun: false, leadQualification: (v || undefined) as QualificationKey | undefined });
                  }}
                >
                  <option value="__coord__">Coordinator (assigned)</option>
                  <option value="">Open — no qualification</option>
                  {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[])
                    .sort((a, b) => QUALIFICATION_LABELS[a].localeCompare(QUALIFICATION_LABELS[b]))
                    .map((k) => (
                      <option key={k} value={k}>
                        Open — {QUALIFICATION_LABELS[k]}
                      </option>
                    ))}
                </Select>
                <button
                  type="button"
                  aria-label="Remove course"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => setCourses((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setCourses((p) => [...p, { name: '', minHours: 0 }])}>
            + Add course
          </Button>
        </fieldset>

        {/* Per-discipline roster configuration — extend as new modules ship. */}
        <fieldset className="rounded-md border border-watch-100 p-3">
          <legend className="px-1 text-sm font-medium text-watch-800">Roster modules</legend>
          <p className="mb-2 text-xs text-slate-500">
            Which tabs appear on this discipline's roster. <strong>Members</strong> always shows.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked disabled /> Members <span className="text-xs">(always on)</span>
            </label>
            {ROSTER_MODULES.map((m) => (
              <label
                key={m.key}
                className={`flex items-center gap-2 text-sm ${m.comingSoon ? 'text-slate-400' : 'text-watch-800'}`}
                title={m.comingSoon ? 'Print format not built yet' : undefined}
              >
                <input
                  type="checkbox"
                  disabled={m.comingSoon}
                  checked={rosterModules.includes(m.key)}
                  onChange={() => toggleModule(m.key)}
                />
                {m.label}
                {m.comingSoon && <span className="text-xs">(coming soon)</span>}
              </label>
            ))}
          </div>
        </fieldset>

        {!isDefaults && (
          <>
            {/* Per-discipline branding overrides */}
            <fieldset className="rounded-md border border-watch-100 p-3">
              <legend className="px-1 text-sm font-medium text-watch-800">Document branding (override)</legend>
              <p className="mb-2 text-xs text-slate-500">
                Optional — used on THIS discipline's printed documents instead of the org's. Blank fields fall back
                to <strong>Org Settings</strong>. Lets one org run a program under a different identity (e.g. a
                Sheriff's Office NMT program).
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Logo">
                  <div className="flex items-center gap-2">
                    {brandLogoUrl && <img src={brandLogoUrl} alt="" className="h-9 w-auto rounded border border-watch-100 object-contain" />}
                    <label className="cursor-pointer rounded-md border border-watch-200 px-2 py-1 text-xs font-medium text-watch-700 hover:bg-watch-50">
                      {uploading ? 'Uploading…' : brandLogoUrl ? 'Replace' : 'Upload'}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                    </label>
                    {brandLogoUrl && <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => setBrandLogoUrl('')}>Remove</button>}
                  </div>
                </Field>
                <Field label="Organization name override">
                  <Input value={brandOrgName} onChange={(e) => setBrandOrgName(e.target.value)} placeholder="e.g. Pasco Sheriff's Office" />
                </Field>
                <Field label="Tagline override">
                  <Input value={brandTagline} onChange={(e) => setBrandTagline(e.target.value)} placeholder="e.g. We Fight as One" />
                </Field>
                <Field label="Address / contact lines (one per line)">
                  <TextArea value={brandAddress} onChange={(e) => setBrandAddress(e.target.value)} rows={2} />
                </Field>
              </div>
            </fieldset>

            {/* Per-discipline forms */}
            <fieldset className="rounded-md border border-watch-100 p-3">
              <legend className="px-1 text-sm font-medium text-watch-800">Forms for this discipline</legend>
              <p className="mb-2 text-xs text-slate-500">
                Every general document is offered by default. Uncheck to hide one here, or swap it for a specialized
                version assigned to your org. Manage the library under <strong>Owner → Report Forms</strong>.
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {baseGeneral.map((f) => (
                  <div key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-watch-800">
                      <input type="checkbox" checked={!disabledForms.includes(f.id)} onChange={() => toggleDisabled(f.id)} />
                      <span className={disabledForms.includes(f.id) ? 'text-slate-400 line-through' : ''}>{f.name}</span>
                    </label>
                    {specializedForms.length > 0 && !disabledForms.includes(f.id) && (
                      <Select className="!w-48 text-xs" value={formOverrides[f.id] ?? ''} onChange={(e) => setOverride(f.id, e.target.value)}>
                        <option value="">Use default</option>
                        {specializedForms.map((s) => <option key={s.id} value={s.id}>↳ {s.name}</option>)}
                      </Select>
                    )}
                  </div>
                ))}
              </div>
              {specializedForms.length > 0 && (
                <div className="mt-3 border-t border-watch-50 pt-2">
                  <p className="mb-1 text-xs font-medium text-watch-700">Add specialized forms</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {specializedForms
                      .filter((s) => !Object.values(formOverrides).includes(s.id))
                      .map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm text-watch-800">
                          <input type="checkbox" checked={addedForms.includes(s.id)} onChange={() => toggleAdded(s.id)} />
                          {s.name}
                        </label>
                      ))}
                  </div>
                </div>
              )}
            </fieldset>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save discipline
          </Button>
        </div>
      </form>
    </Modal>
  );
}
