/**
 * Admin — Curriculum & Hours: the editable list of disciplines, each with its
 * course blocks and FDLE minimum hours. The discipline's default target hours
 * is always the sum of its course hours; academies pick a discipline at
 * creation and the builder tracks per-course coverage against these minimums.
 */
import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, FieldPath, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { orgConfigPath, useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAllCurricula } from '../../lib/curricula';
import { useAuth } from '../../auth/AuthContext';
import type { CurriculumCourse, CurriculumDoc, QualificationKey, ReportConfigDoc, RosterModuleKey } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';
import { ROSTER_MODULES, DEFAULT_ROSTER_MODULES } from '../cadre/roster/rosterModules';
import { courseKey } from '../cadre/roster/rosterShared';
import { REPORT_TYPES } from '../cadre/reports/reportTypes';
import { useOrgLibraryForms } from '../cadre/reports/documentLibrary';
import { friendlyError } from '../../lib/callableError';


/**
 * Curriculum & Hours editor. scope='org' edits the active org's curricula;
 * scope='defaults' (owner only) edits the platform DEFAULT templates that every
 * new organization is seeded from.
 */
export function CurriculumAdminPage({ scope = 'org' }: { scope?: 'org' | 'defaults' }) {
  const { firebaseUser, orgId } = useAuth();
  const isDefaults = scope === 'defaults';
  // This org's written-exam facts (question count + time limit per course) —
  // org-owned even for the read-only platform programs.
  const { data: reportCfg } = useDoc<ReportConfigDoc>(!isDefaults && orgId ? orgConfigPath('reportConfig', orgId) : null);
  const [testInfoFor, setTestInfoFor] = useState<WithId<CurriculumDoc> | null>(null);
  const coll = isDefaults ? 'defaultCurricula' : 'curricula';
  // Owner edits the five platform FDLE programs (defaultCurricula). An org sees
  // those read-only — the single source of truth across all orgs — and may add or
  // edit only its OWN curricula below.
  // Only the owner console needs this list; org scope already gets the platform
  // set via useAllCurricula — a second live listener here was pure duplication.
  const ownerDefaults = useCollection<CurriculumDoc>(isDefaults ? 'defaultCurricula' : null);
  const orgView = useAllCurricula();
  const platformCards = isDefaults ? [] : orgView.platform;
  const editable = isDefaults ? ownerDefaults.data : orgView.org;
  const [editing, setEditing] = useState<WithId<CurriculumDoc> | 'new' | null>(null);

  async function toggleActive(c: WithId<CurriculumDoc>) {
    await setDoc(doc(db, coll, c.id), { active: !c.active }, { merge: true });
  }

  async function remove(c: WithId<CurriculumDoc>) {
    if (!window.confirm(`Delete the "${c.label}" discipline?${isDefaults ? '' : ' Existing academies keep their data; new academies can no longer pick it.'}`)) return;
    await deleteDoc(doc(db, coll, c.id));
    if (!isDefaults) await logAudit(firebaseUser!.uid, 'curriculum.delete', 'curriculum', c.id, c.label);
  }

  const renderCard = (c: WithId<CurriculumDoc>, readOnly: boolean) => (
    <section key={c.id} className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-watch-900">{c.label}</h3>
          <div className="text-xs text-slate-500">{c.fdleProgram}</div>
        </div>
        <div className="flex items-center gap-2">
          {readOnly && <Badge tone="slate">Platform</Badge>}
          {c.estimated && <Badge tone="amber">estimated hours</Badge>}
          <Badge tone={c.active ? 'green' : 'slate'}>{c.active ? 'active' : 'inactive'}</Badge>
        </div>
      </div>
      <div className="mb-2 text-sm text-watch-800">
        <strong>{c.totalHours}</strong> required hours
        {(() => {
          const opt = c.courses.filter((x) => x.optional).reduce((s, x) => s + x.minHours, 0);
          return opt > 0 ? <span className="text-slate-500"> · +{opt} optional</span> : null;
        })()}{' '}
        · {c.courses.length} course blocks
      </div>
      <ul className="mb-3 max-h-44 space-y-0.5 overflow-y-auto pr-1 text-sm">
        {c.courses.map((course) => (
          <li key={course.cjk || course.name} className="flex justify-between gap-2">
            <span className="truncate text-slate-600">
              {course.cjk && <span className="mr-1 font-mono text-xs text-slate-400">{course.cjk}</span>}
              {course.name}
              {course.optional && <span className="ml-1 text-[10px] font-semibold uppercase text-slate-400">optional</span>}
            </span>
            <span className="shrink-0 tabular-nums text-slate-400">{course.minHours} hrs</span>
          </li>
        ))}
      </ul>
      {readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setTestInfoFor(c)} title="Your organization's question counts and time limits for this program's written exams">Test info</Button>
          <p className="text-xs text-slate-400">Courses managed by the platform owner — identical across every organization.</p>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => setEditing(c)}>Edit</Button>
          {!isDefaults && <Button onClick={() => setTestInfoFor(c)} title="Question counts and time limits for this curriculum's written exams">Test info</Button>}
          <Button variant="ghost" onClick={() => toggleActive(c)}>
            {c.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="ghost" onClick={() => remove(c)}>
            Delete
          </Button>
        </div>
      )}
    </section>
  );

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
          ? 'The platform FDLE programs every organization sees read-only — the single source of truth across all tenants. Edit a program here to change it for everyone; organizations add their own curricula (and their own test info) from Admin → Curriculum & Hours.'
          : "The five platform FDLE programs (Law Enforcement, Corrections, both crossovers, and EOT) are managed by HEIMDALL and shown read-only — the single source of truth across every organization. Below them, add your ORG'S OWN curricula (course list, hours, high-liability ▲, lead-instructor qualification). The builder, roster, and reports all pull from here."}
      </p>

      {platformCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Platform FDLE programs
            <span className="ml-1 font-normal normal-case text-slate-400">— managed by HEIMDALL, identical across every organization</span>
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {[...platformCards].sort((a, b) => a.label.localeCompare(b.label)).map((c) => renderCard(c, true))}
          </div>
        </section>
      )}
      {!isDefaults && (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your organization’s curricula</h2>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {!isDefaults && editable.length === 0 && (
          <p className="text-sm text-slate-500">No organization-specific curricula yet — the platform programs above are available to every class. Use “New discipline” to add your own.</p>
        )}
        {[...editable].sort((a, b) => a.label.localeCompare(b.label)).map((c) => renderCard(c, false))}
      </div>

      {testInfoFor && orgId && (
        <TestInfoModal
          curriculum={testInfoFor}
          orgId={orgId}
          current={reportCfg?.examInfo?.[testInfoFor.id] ?? {}}
          onClose={() => setTestInfoFor(null)}
        />
      )}
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


/**
 * Org-owned test facts for one curriculum: number of questions + time limit
 * per course. Lives on reportConfig/{orgId}.examInfo[curriculumId] (admin
 * write, already org-scoped by the rules) so an org can set them even for the
 * read-only platform programs. Auto-fills the Examination Rules & Disclosure
 * form printed with a test day's documents.
 */
function TestInfoModal({
  curriculum,
  orgId,
  current,
  onClose,
}: {
  curriculum: WithId<CurriculumDoc>;
  orgId: string;
  current: Record<string, { questions?: number; minutes?: number }>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Record<string, { questions: string; minutes: string }>>(() =>
    Object.fromEntries(
      curriculum.courses.map((c) => {
        const cur = current[courseKey(c)];
        return [courseKey(c), { questions: cur?.questions ? String(cur.questions) : '', minutes: cur?.minutes ? String(cur.minutes) : '' }];
      })
    )
  );
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tested = curriculum.courses.filter((c) => c.tested);
  // Programs with no courses flagged "tested" list everything.
  const listed = showAll || tested.length === 0 ? curriculum.courses : tested;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const map: Record<string, { questions?: number; minutes?: number }> = {};
      for (const [key, r] of Object.entries(rows)) {
        const q = Math.round(Number(r.questions));
        const m = Math.round(Number(r.minutes));
        const entry = { ...(q > 0 ? { questions: q } : {}), ...(m > 0 ? { minutes: m } : {}) };
        if (Object.keys(entry).length) map[key] = entry;
      }
      // mergeFields replaces ONLY this curriculum's sub-map (so a cleared row
      // really clears) while leaving categories/overrides/other curricula alone.
      await setDoc(doc(db, orgConfigPath('reportConfig', orgId)), { examInfo: { [curriculum.id]: map } }, { mergeFields: [new FieldPath('examInfo', curriculum.id)] });
      onClose();
    } catch (err) {
      setError(friendlyError(err, 'Could not save the test info.'));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Test info — ${curriculum.label}`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Your organization&apos;s written-exam details. When a session is marked as a test, the day&apos;s documents
          print the <strong>Examination Rules &amp; Disclosure</strong> form with these filled in. Leave a row blank
          if a course has no written exam.
        </p>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-watch-100">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
              <tr>
                <th className="px-3 py-2">Course</th>
                <th className="w-28 px-2 py-2">Questions</th>
                <th className="w-32 px-2 py-2">Time limit (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-watch-50">
              {listed.map((c) => {
                const key = courseKey(c);
                const r = rows[key] ?? { questions: '', minutes: '' };
                const set = (patch: Partial<{ questions: string; minutes: string }>) => setRows((prev) => ({ ...prev, [key]: { ...r, ...patch } }));
                return (
                  <tr key={key}>
                    <td className="px-3 py-1.5">
                      {c.cjk && <span className="mr-1 font-mono text-xs text-slate-400">{c.cjk}</span>}
                      {c.name}
                    </td>
                    <td className="px-2 py-1"><Input type="number" min={0} value={r.questions} onChange={(e) => set({ questions: e.target.value })} aria-label={`${c.name} questions`} /></td>
                    <td className="px-2 py-1"><Input type="number" min={0} value={r.minutes} onChange={(e) => set({ minutes: e.target.value })} aria-label={`${c.name} time limit`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {tested.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every course (not just the {tested.length} flagged as tested)
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>Save test info</Button>
        </div>
      </div>
    </Modal>
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
  const [attendanceLayout, setAttendanceLayout] = useState<'grid' | 'signin'>(curriculum?.attendanceLayout ?? 'grid');
  // Sign-ups default for NEW academies of this discipline: existing curricula
  // keep their setting (absent = on, covering platform FDLE programs); a brand
  // NEW discipline starts OFF (agency programs shouldn't reach adjuncts).
  const [signupsDefault, setSignupsDefault] = useState<boolean>(
    curriculum ? curriculum.signupsDefaultEnabled !== false : false
  );
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
      ...(c.optional ? { optional: true } : {}),
      ...(c.instructorRatio ? { instructorRatio: Number(c.instructorRatio) } : {}),
      ...(c.leadQualification && !c.coordinatorRun ? { leadQualification: c.leadQualification } : {}),
      ...(c.defaultRoleSlots && c.defaultRoleSlots.length ? { defaultRoleSlots: c.defaultRoleSlots } : {}),
    }));
    try {
      await setDoc(doc(db, coll, id), {
        ...(isDefaults ? {} : { orgId: orgId! }),
        key: baseKey,
        label,
        fdleProgram,
        courses: cleaned,
        // Optional items don't count toward the REQUIRED total (drives the
        // create-academy target hours + shortfall math).
        totalHours: cleaned.reduce((s, c) => s + (c.optional ? 0 : c.minHours), 0),
        active: curriculum?.active ?? true,
        estimated,
        rosterModules,
        attendanceLayout,
        signupsDefaultEnabled: signupsDefault,
        ...(brandLogoUrl.trim() ? { brandLogoUrl: brandLogoUrl.trim() } : {}),
        ...(brandOrgName.trim() ? { brandOrgName: brandOrgName.trim() } : {}),
        ...(brandTagline.trim() ? { brandTagline: brandTagline.trim() } : {}),
        ...(brandAddress.trim() ? { brandAddressLines: brandAddress.split('\n').map((l) => l.trim()).filter(Boolean) } : {}),
        ...(disabledForms.length ? { disabledForms } : {}),
        ...(Object.keys(formOverrides).length ? { formOverrides } : {}),
        ...(addedForms.length ? { addedForms } : {}),
      } satisfies CurriculumDoc);
      if (!isDefaults) await logAudit(firebaseUser!.uid, 'curriculum.save', 'curriculum', id, `${label} (${total} hrs)`);
      onClose();
    } catch (err) {
      // A rejected write used to strand the modal on a disabled Save forever.
      window.alert(`Save failed: ${friendlyError(err, 'unknown error')}`);
    } finally {
      setBusy(false);
    }
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
          <div className="mb-1 grid min-w-[36rem] grid-cols-[5.5rem_1fr_4rem_2rem_2.5rem_2rem_3.5rem_8.5rem_1.5rem] items-center gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span title="FDLE/CJSTC course number">CJK #</span>
            <span>Course</span>
            <span>Hours</span>
            <span title="High-liability">▲ HL</span>
            <span title="Has an end-of-course exam">Test</span>
            <span title="Optional item — listed and schedulable, but not required (no hour-shortfall warnings)">Opt</span>
            <span title="Students per instructor (FDLE ratio)">Ratio</span>
            <span>Lead / staffing</span>
            <span />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {courses.map((c, i) => (
              <div key={i} className="grid min-w-[36rem] grid-cols-[5.5rem_1fr_4rem_2rem_2.5rem_2rem_3.5rem_8.5rem_1.5rem] items-center gap-2">
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
                  step={0.25}
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
                <input
                  type="checkbox"
                  className="justify-self-center"
                  checked={!!c.optional}
                  aria-label={`Course ${i + 1} optional (not required; no shortfall warnings)`}
                  onChange={(e) => updateCourse(i, { optional: e.target.checked })}
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
          <div className="mt-3 border-t border-watch-50 pt-3">
            <Field label="Attendance roster layout" hint="How this discipline's printed attendance roster looks" className="max-w-xs">
              <Select value={attendanceLayout} onChange={(e) => setAttendanceLayout(e.target.value as 'grid' | 'signin')}>
                <option value="grid">Standard grid (sign-in/out + staff actions)</option>
                <option value="signin">Sign-in sheet (No. / CJIS &amp; Name / Signature — NMT/ARGUS)</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 border-t border-watch-50 pt-3">
            <label className="flex items-start gap-2 text-sm text-watch-800">
              <input type="checkbox" className="mt-0.5" checked={signupsDefault} onChange={(e) => setSignupsDefault(e.target.checked)} />
              <span>
                New academies of this discipline default to <strong>course sign-ups enabled</strong>
                <span className="block text-xs text-slate-500">
                  FDLE programs default on. Agency-funded programs (sheriff&apos;s-office training, not college
                  classes) should stay off so their classes are never accidentally opened to college adjuncts.
                  Each academy can override this at creation or on its builder.
                </span>
              </span>
            </label>
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
