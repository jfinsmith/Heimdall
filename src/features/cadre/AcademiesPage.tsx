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
  where,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { fmtDate, tsFromDate } from '../../lib/time';
import type { AcademyDoc, SessionDoc, UserDoc } from '../../types';
import { DISCIPLINE_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';

const DEFAULT_TARGET_HOURS: Record<string, number> = {
  law_enforcement: 770, // FDLE LE BRTP — configurable per academy, not hard-coded
  corrections: 520,
  cross_over: 318,
};

export function AcademiesPage() {
  const { firebaseUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<WithId<AcademyDoc> | null>(null);

  // Global "+ Create" action deep-links here with ?create=1
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreateOpen(true);
      params.delete('create');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const { data: academies, loading } = useCollection<AcademyDoc>('academies', [orderBy('startDate', 'desc')]);

  return (
    <div>
      <PageHeader
        kicker="CADRE — Coordinated Academy Duty & Roster Engine"
        title="Academies"
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New academy
          </Button>
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
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{DISCIPLINE_LABELS[a.discipline]}</td>
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
                </td>
              </tr>
            ))}
            {!loading && academies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No academies yet. Create the first cohort.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateAcademyModal open={createOpen} onClose={() => setCreateOpen(false)} actorUid={firebaseUser?.uid ?? ''} />
      {cloneSource && (
        <CloneAcademyModal source={cloneSource} onClose={() => setCloneSource(null)} actorUid={firebaseUser?.uid ?? ''} />
      )}
    </div>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────
function CreateAcademyModal({ open, onClose, actorUid }: { open: boolean; onClose: () => void; actorUid: string }) {
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState<'law_enforcement' | 'corrections' | 'cross_over'>('law_enforcement');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [targetHours, setTargetHours] = useState(DEFAULT_TARGET_HOURS.law_enforcement);
  const [coordinators, setCoordinators] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: staffUsers } = useCollection<UserDoc>('users', [
    where('role', 'in', ['coordinator', 'sergeant', 'lieutenant', 'director']),
  ]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await addDoc(collection(db, 'academies'), {
      name,
      discipline,
      fdleProgram: `FDLE Basic Recruit Training Program — ${DISCIPLINE_LABELS[discipline]}`,
      startDate: tsFromDate(new Date(`${startDate}T00:00:00`)),
      endDate: tsFromDate(new Date(`${endDate}T23:59:59`)),
      location,
      status: 'draft',
      coordinatorIds: coordinators,
      targetTotalHours: targetHours,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies Omit<AcademyDoc, 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'> & Record<string, unknown>);
    setBusy(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New academy (cohort)">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" hint='e.g. "BLE Class 2026-02"'>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Discipline">
            <Select
              value={discipline}
              onChange={(e) => {
                const d = e.target.value as typeof discipline;
                setDiscipline(d);
                setTargetHours(DEFAULT_TARGET_HOURS[d]);
              }}
            >
              <option value="law_enforcement">Law Enforcement</option>
              <option value="corrections">Corrections</option>
              <option value="cross_over">Cross-Over</option>
            </Select>
          </Field>
          <Field label="Target total hours" hint="FDLE program hours — adjust as needed">
            <Input type="number" min={1} value={targetHours} onChange={(e) => setTargetHours(Number(e.target.value))} />
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
        <Field label="Location" hint='e.g. "State College Public Safety Campus"'>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} required />
        </Field>
        <Field label="Coordinators">
          <Select
            multiple
            value={coordinators}
            onChange={(e) => setCoordinators([...e.target.selectedOptions].map((o) => o.value))}
            size={4}
          >
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.role})
              </option>
            ))}
          </Select>
        </Field>
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
  const [name, setName] = useState(`${source.name} (copy)`);
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

    const academyRef = await addDoc(collection(db, 'academies'), {
      ...source,
      id: undefined,
      name,
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
    <Modal open onClose={onClose} title={`Clone "${source.name}"`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Copies the entire schedule ({fmtDate(source.startDate)} → {fmtDate(source.endDate)}) and shifts every
          session by the same number of days to the new start date. Sign-ups are not copied.
        </p>
        <Field label="New academy name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="New start date">
          <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />
        </Field>
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
