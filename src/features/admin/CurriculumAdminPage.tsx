/**
 * Admin — Curriculum & Hours: the editable list of disciplines, each with its
 * course blocks and FDLE minimum hours. The discipline's default target hours
 * is always the sum of its course hours; academies pick a discipline at
 * creation and the builder tracks per-course coverage against these minimums.
 */
import React, { useState } from 'react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { CurriculumCourse, CurriculumDoc, QualificationKey } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

export function CurriculumAdminPage() {
  const { firebaseUser } = useAuth();
  const { data: curricula } = useCollection<CurriculumDoc>('curricula');
  const [editing, setEditing] = useState<WithId<CurriculumDoc> | 'new' | null>(null);

  async function toggleActive(c: WithId<CurriculumDoc>) {
    await setDoc(doc(db, 'curricula', c.id), { active: !c.active }, { merge: true });
  }

  async function remove(c: WithId<CurriculumDoc>) {
    if (!window.confirm(`Delete the "${c.label}" discipline? Existing academies keep their data; new academies can no longer pick it.`)) return;
    await deleteDoc(doc(db, 'curricula', c.id));
    await logAudit(firebaseUser!.uid, 'curriculum.delete', 'curriculum', c.id, c.label);
  }

  return (
    <div>
      <PageHeader
        back
        kicker="Admin"
        title="Curriculum & Hours"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New discipline
          </Button>
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Each discipline's full course list lives here — the course name, required hours, whether it's
        high-liability (▲), and the qualification a lead instructor must hold. This is the single source
        for the builder's course picker and curriculum coverage (there's no separate course catalog).
        Editing changes defaults for new academies — existing academies aren't modified.
      </p>

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
                    <span className="truncate text-slate-600">{course.name}</span>
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
          curriculum={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CurriculumEditorModal({
  curriculum,
  onClose,
}: {
  curriculum: WithId<CurriculumDoc> | null;
  onClose: () => void;
}) {
  const { firebaseUser } = useAuth();
  const [label, setLabel] = useState(curriculum?.label ?? '');
  const [fdleProgram, setFdleProgram] = useState(curriculum?.fdleProgram ?? '');
  const [key, setKey] = useState(curriculum?.id ?? '');
  const [courses, setCourses] = useState<CurriculumCourse[]>(curriculum?.courses ?? [{ name: '', minHours: 0 }]);
  const [estimated, setEstimated] = useState(curriculum?.estimated ?? false);
  const [busy, setBusy] = useState(false);

  const total = courses.reduce((sum, c) => sum + (Number(c.minHours) || 0), 0);

  function updateCourse(i: number, patch: Partial<CurriculumCourse>) {
    setCourses((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const id = curriculum?.id ?? key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const cleaned = courses.filter((c) => c.name.trim()).map((c) => ({
      name: c.name.trim(),
      minHours: Number(c.minHours) || 0,
      ...(c.highLiability ? { highLiability: true } : {}),
      ...(c.coordinatorRun ? { coordinatorRun: true } : {}),
      ...(c.leadQualification && !c.coordinatorRun ? { leadQualification: c.leadQualification } : {}),
      ...(c.defaultRoleSlots && c.defaultRoleSlots.length ? { defaultRoleSlots: c.defaultRoleSlots } : {}),
    }));
    await setDoc(doc(db, 'curricula', id), {
      key: id,
      label,
      fdleProgram,
      courses: cleaned,
      totalHours: cleaned.reduce((s, c) => s + c.minHours, 0),
      active: curriculum?.active ?? true,
      estimated,
    } satisfies CurriculumDoc);
    await logAudit(firebaseUser!.uid, 'curriculum.save', 'curriculum', id, `${label} (${total} hrs)`);
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
          <div className="mb-1 grid grid-cols-[1fr_4.5rem_2.5rem_9rem_1.5rem] items-center gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Course</span>
            <span>Hours</span>
            <span title="High-liability">▲ HL</span>
            <span>Lead / staffing</span>
            <span />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {courses.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_4.5rem_2.5rem_9rem_1.5rem] items-center gap-2">
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
