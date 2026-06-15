/**
 * CADRE — Academies: list cohorts, create a new academy, clone an existing
 * one (full schedule copy with all dates shifted to a new start).
 */
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate, tsFromDate, addDays, toDateInputValue } from '../../lib/time';
import type { AcademyDoc, CurriculumDoc, SessionDoc, UserDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { ACADEMY_COLORS, nextAcademyColor } from '../../lib/academyColors';
import { logAudit } from '../sessions/audit';

const DEFAULT_LOCATION = 'PHSC — Dade City, FL';

export function AcademiesPage() {
  const { firebaseUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [templateCreateOpen, setTemplateCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<WithId<AcademyDoc> | null>(null);
  const [deleteSource, setDeleteSource] = useState<WithId<AcademyDoc> | null>(null);

  // Global "+ Create" action deep-links here with ?create=1
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreateOpen(true);
      params.delete('create');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const { data: allAcademies, loading } = useCollection<AcademyDoc>('academies', [orderBy('startDate', 'desc')]);
  const [showArchived, setShowArchived] = useState(false);
  // Quarterly start templates, shown in calendar order: January, April, July, October.
  const templates = allAcademies
    .filter((a) => a.isTemplate)
    .sort((a, b) => a.startDate.toDate().getMonth() - b.startDate.toDate().getMonth());
  const academies = allAcademies
    .filter((a) => !a.isTemplate)
    .filter((a) => showArchived || a.status !== 'archived');

  async function setArchived(a: WithId<AcademyDoc>, archived: boolean) {
    if (archived && !window.confirm(`Archive "${a.name}"? It disappears from instructor views; you can unarchive any time.`)) return;
    await updateDoc(doc(db, 'academies', a.id), { status: archived ? 'archived' : 'completed', updatedAt: serverTimestamp() });
    await logAudit(firebaseUser!.uid, archived ? 'academy.archive' : 'academy.unarchive', 'academy', a.id, a.name);
  }

  return (
    <div>
      <PageHeader
        kicker="CADRE — Coordinated Academy Duty & Roster Engine"
        title="Academies"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-sm text-slate-500">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            <Button onClick={() => setTemplateCreateOpen(true)}>New template</Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New academy
            </Button>
          </>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-4 py-3">Academy</th>
              <th className="px-4 py-3">Discipline</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Target hrs</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {academies.map((a) => (
              <tr key={a.id} className="hover:bg-watch-50/50">
                <td className="px-4 py-3 font-medium text-watch-900">
                  <Link to={`/cadre/academies/${a.id}`} className="hover:underline">
                    {a.shortName ? <span className="mr-2 font-bold text-bifrost-700">{a.shortName}</span> : null}
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{a.fdleProgram?.replace(/^FDLE\s*/, '') || a.discipline}</td>
                <td className="px-4 py-3 text-slate-500">
                  {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={a.status === 'published' || a.status === 'in_progress' ? 'green' : a.status === 'draft' ? 'slate' : 'navy'}>
                    {a.status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="px-4 py-3">{a.targetTotalHours}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" onClick={() => setCloneSource(a)}>
                    Clone
                  </Button>
                  {a.status === 'archived' ? (
                    <Button variant="ghost" onClick={() => setArchived(a, false)}>
                      Unarchive
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setArchived(a, true)}>
                      Archive
                    </Button>
                  )}
                  <Button variant="ghost" className="text-red-700" onClick={() => setDeleteSource(a)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && academies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No academies yet. Create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Templates — reusable schedule patterns; "Use" clones one into a real academy */}
      {templates.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Schedule templates</h2>
          <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
                <tr>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Discipline</th>
                  <th className="px-4 py-3">Sessions span</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-watch-50">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-watch-50/50">
                    <td className="px-4 py-3 font-medium text-watch-900">
                      <Link to={`/cadre/academies/${t.id}`} className="hover:underline">
                        {t.shortName ? <span className="mr-2 font-bold text-bifrost-700">{t.shortName}</span> : null}
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{t.fdleProgram?.replace(/^FDLE\s*/, '') || t.discipline}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {fmtDate(t.startDate)} → {fmtDate(t.endDate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="primary" onClick={() => setCloneSource(t)}>
                        Use template
                      </Button>
                      <Button variant="ghost" className="text-red-700" onClick={() => setDeleteSource(t)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <CreateAcademyModal open={createOpen} onClose={() => setCreateOpen(false)} actorUid={firebaseUser?.uid ?? ''} />
      <CreateAcademyModal open={templateCreateOpen} onClose={() => setTemplateCreateOpen(false)} actorUid={firebaseUser?.uid ?? ''} isTemplate />
      {cloneSource && (
        <CloneAcademyModal
          source={cloneSource}
          onClose={() => setCloneSource(null)}
          actorUid={firebaseUser?.uid ?? ''}
        />
      )}
      {deleteSource && (
        <DeleteAcademyModal
          academy={deleteSource}
          onClose={() => setDeleteSource(null)}
          actorUid={firebaseUser?.uid ?? ''}
        />
      )}
    </div>
  );
}

// ── Delete (cascade: academy + sessions + sign-ups + assignments) ───────────
function DeleteAcademyModal({
  academy,
  onClose,
  actorUid,
}: {
  academy: WithId<AcademyDoc>;
  onClose: () => void;
  actorUid: string;
}) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const canDelete = confirm === 'DELETE';

  async function doDelete() {
    if (!canDelete) return;
    setBusy(true);
    try {
      setProgress('Finding sessions…');
      const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('academyId', '==', academy.id)));
      // Collect every doc to remove: each session's sign-ups, the sessions, the
      // assignment mirrors, and finally the academy itself.
      const refs: ReturnType<typeof doc>[] = [];
      setProgress('Clearing sign-ups…');
      for (const sess of sessionsSnap.docs) {
        const signups = await getDocs(collection(db, 'sessions', sess.id, 'signups'));
        signups.forEach((su) => refs.push(su.ref));
        refs.push(sess.ref);
      }
      const assignmentsSnap = await getDocs(query(collection(db, 'assignments'), where('academyId', '==', academy.id)));
      assignmentsSnap.forEach((a) => refs.push(a.ref));
      refs.push(doc(db, 'academies', academy.id));

      setProgress(`Deleting ${refs.length} records…`);
      for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      await logAudit(actorUid, 'academy.delete', 'academy', academy.id, `Deleted ${academy.name} (${sessionsSnap.size} sessions)`);
      onClose();
    } catch (err) {
      setBusy(false);
      setProgress('');
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Delete "${academy.name}"`}>
      <div className="space-y-4 text-sm">
        <div className="rounded-md bg-red-50 px-3 py-3 text-red-800">
          <p className="font-semibold">This permanently deletes the academy and everything in it.</p>
          <p className="mt-1">
            All sessions, sign-ups, and assignments for <strong>{academy.shortName || academy.name}</strong> will be
            erased. This cannot be undone.
          </p>
        </div>
        <Field label="Type DELETE (all caps) to confirm">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoFocus disabled={busy} />
        </Field>
        {progress && <p className="text-bifrost-700">{progress}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!canDelete || busy} onClick={doDelete}>
            {busy ? 'Deleting…' : 'Delete academy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────
function CreateAcademyModal({
  open,
  onClose,
  actorUid,
  isTemplate = false,
}: {
  open: boolean;
  onClose: () => void;
  actorUid: string;
  isTemplate?: boolean;
}) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [defaultRoom, setDefaultRoom] = useState('');
  const [targetHours, setTargetHours] = useState(0);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [busy, setBusy] = useState(false);

  // Disciplines come from the admin-editable curricula collection; the
  // default target hours are that curriculum's course-hour sum.
  const { data: curricula } = useCollection<CurriculumDoc>('curricula', [where('active', '==', true)]);
  // Sergeants and above can edit everything regardless of assignment — the
  // coordinator list here is genuinely just coordinators.
  const { data: coordinatorUsers } = useCollection<UserDoc>('users', [where('role', '==', 'coordinator')]);
  const { data: existingAcademies } = useCollection<AcademyDoc>('academies');

  const curriculum = curricula.find((c) => c.id === discipline);
  // Default to the next unused palette color so new cohorts auto-differentiate.
  const [color, setColor] = useState('');
  const defaultColor = color || nextAcademyColor(existingAcademies.map((a) => a.color ?? '').filter(Boolean));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await addDoc(collection(db, 'academies'), {
      name,
      shortName,
      discipline,
      color: defaultColor,
      fdleProgram: curriculum?.fdleProgram ?? curriculum?.label ?? discipline,
      startDate: tsFromDate(new Date(`${startDate}T00:00:00`)),
      endDate: tsFromDate(new Date(`${endDate}T23:59:59`)),
      location,
      defaultRoom,
      status: 'draft',
      isTemplate,
      coordinatorIds: [...new Set([primary, secondary].filter(Boolean))],
      targetTotalHours: targetHours,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setBusy(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={isTemplate ? 'New schedule template' : 'New academy'}>
      <form onSubmit={submit} className="space-y-4">
        {isTemplate && (
          <p className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
            Build this like a normal academy. It won't appear on calendars or rosters — coordinators
            create real academies from it later, shifting the dates.
          </p>
        )}
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <Field label="Class designation" hint='Short label, e.g. "LE 131", "CO 67" — leads calendar entries'>
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} required placeholder={isTemplate ? 'LE — Jan Start' : 'LE 133'} />
          </Field>
          <Field label="Name" hint={isTemplate ? 'e.g. "LE — January Start Template"' : 'e.g. "LE 133 (October Start)"'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Discipline" hint="Manage the list under Admin → Curriculum & Hours">
            <Select
              value={discipline}
              required
              onChange={(e) => {
                setDiscipline(e.target.value);
                const c = curricula.find((x) => x.id === e.target.value);
                if (c) setTargetHours(c.totalHours);
              }}
            >
              <option value="">Select a discipline…</option>
              {[...curricula].sort((a, b) => a.label.localeCompare(b.label)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.totalHours} hrs)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target total hours" hint="Defaults to the curriculum sum — adjust if needed">
            <Input type="number" min={1} step="any" value={targetHours} onChange={(e) => setTargetHours(Number(e.target.value))} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} required />
          </Field>
          <Field label="Default room" hint="Prefilled on new sessions; individual days can differ">
            <Input value={defaultRoom} onChange={(e) => setDefaultRoom(e.target.value)} placeholder="E-120" />
          </Field>
        </div>
        <Field label="Calendar color" hint="Distinguishes this academy on shared calendars">
          <div className="flex items-center gap-2">
            <Select value={defaultColor} onChange={(e) => setColor(e.target.value)} className="flex-1">
              {ACADEMY_COLORS.map((c) => (
                <option key={c.value} value={c.value}>{c.name}</option>
              ))}
            </Select>
            <span className="h-7 w-7 shrink-0 rounded-md ring-1 ring-watch-200" style={{ backgroundColor: defaultColor }} />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary coordinator" hint="Default owner for assigned blocks">
            <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">— none —</option>
              {[...coordinatorUsers].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Secondary coordinator">
            <Select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              <option value="">— none —</option>
              {coordinatorUsers.filter((u) => u.id !== primary).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Create academy
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Clone (copy full schedule, shift all dates) ─────────────────────────────
function CloneAcademyModal({
  source,
  onClose,
  actorUid,
}: {
  source: WithId<AcademyDoc>;
  onClose: () => void;
  actorUid: string;
}) {
  const isTemplate = !!source.isTemplate;
  const [name, setName] = useState(isTemplate ? source.name.replace(/template/i, '').trim() || source.name : `${source.name} (copy)`);
  const [shortName, setShortName] = useState(source.shortName ?? '');
  const [newStart, setNewStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProgress('Copying academy…');

    // Day-offset between old and new start; every session shifts by the same amount.
    const oldStart = source.startDate.toDate();
    const newStartDate = new Date(`${newStart}T00:00:00`);
    const offsetMs =
      new Date(newStartDate.getFullYear(), newStartDate.getMonth(), newStartDate.getDate()).getTime() -
      new Date(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate()).getTime();

    // Strip the doc id from the source before copying (Firestore rejects an
    // `id: undefined` field). The result is always a real academy, never a template.
    const { id: _id, ...sourceData } = source;
    const academyRef = await addDoc(collection(db, 'academies'), {
      ...sourceData,
      name,
      shortName,
      isTemplate: false,
      startDate: tsFromDate(new Date(source.startDate.toDate().getTime() + offsetMs)),
      endDate: tsFromDate(new Date(source.endDate.toDate().getTime() + offsetMs)),
      status: 'draft', // clones always start as drafts
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setProgress('Copying sessions…');
    const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('academyId', '==', source.id)));

    // Batched writes, 400 per batch (Firestore limit is 500).
    let batch = writeBatch(db);
    let count = 0;
    for (const snap of sessionsSnap.docs) {
      const s = snap.data() as SessionDoc;
      const ref = doc(collection(db, 'sessions'));
      batch.set(ref, {
        ...s,
        academyId: academyRef.id,
        start: tsFromDate(new Date(s.start.toDate().getTime() + offsetMs)),
        end: tsFromDate(new Date(s.end.toDate().getTime() + offsetMs)),
        status: 'draft',
        // Staffing does NOT copy — new cohort starts unstaffed.
        roleSlots: s.roleSlots.map((slot) => ({ ...slot, filledBy: [] })),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
      });
      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    await batch.commit();

    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={isTemplate ? `Create academy from "${source.name}"` : `Clone "${source.name}"`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          {isTemplate
            ? 'Creates a new academy from this template, shifting every session to your new start date. '
            : 'Copies the entire schedule and shifts every session by the same number of days to the new start date. '}
          Sign-ups are not copied. ({fmtDate(source.startDate)} → {fmtDate(source.endDate)})
        </p>
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <Field label="Class designation">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} required placeholder="LE 133" />
          </Field>
          <Field label="New academy name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        </div>
        <Field label="New start date">
          <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />
        </Field>
        {/* Quarter/year presets — "January class → January next year" in one click */}
        <div className="flex flex-wrap gap-2">
          {[3, 6, 9, 12].map((months) => {
            const d = new Date(source.startDate.toDate());
            d.setMonth(d.getMonth() + months);
            return (
              <Button key={months} type="button" variant="ghost" onClick={() => setNewStart(toDateInputValue(d))}>
                +{months === 12 ? '1 year' : `${months} mo`} ({d.toLocaleDateString()})
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          After cloning, the builder flags any sessions that land on school holidays and offers a
          one-click "shift to next school day" fix.
        </p>
        {progress && busy && <p className="text-sm text-bifrost-700">{progress}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Clone schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
