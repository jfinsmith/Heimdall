/**
 * CADRE — Lunch / break PLACEHOLDER editor.
 *
 * A lunch block is a non-instructional placeholder drawn on the builder (and the
 * printed schedule) for context only. It is ALWAYS hours:0, carries no role
 * slots, is never staffed or signed up for, and is excluded from every hours
 * total (kind:'lunch' + hours:0 + countsTowardFdle:false). Times snap to
 * 15-minute intervals. This is separate from the per-session lunch carve-out
 * (SessionFormModal's lunchMinutes), which is unchanged.
 */
import React, { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { combineDateTime, toDateInputValue, toTimeInputValue, tsFromDate } from '../../lib/time';
import type { AcademyDoc, SessionDoc } from '../../types';
import { Button, Field, Input } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

/** Round a Date's minutes to the nearest 15 (lunch blocks live on 15-min intervals). */
function snap15(d: Date): Date {
  const out = new Date(d);
  out.setMinutes(Math.round(out.getMinutes() / 15) * 15, 0, 0);
  return out;
}

export function LunchBlockModal({
  academy,
  lunch,
  defaultDate,
  onClose,
}: {
  academy: WithId<AcademyDoc>;
  lunch?: WithId<SessionDoc> | null;
  defaultDate?: string;
  onClose: () => void;
}) {
  const { firebaseUser } = useAuth();
  const editing = !!lunch;

  const initialDate = lunch ? toDateInputValue(lunch.start.toDate()) : defaultDate || '';
  const initialTime = lunch ? toTimeInputValue(lunch.start.toDate()) : '12:00';
  const initialDuration = lunch
    ? Math.max(15, Math.round((lunch.end.toMillis() - lunch.start.toMillis()) / 60000))
    : 60;

  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState<number>(initialDuration);
  const [label, setLabel] = useState(lunch?.courseName || 'Lunch');
  const [room, setRoom] = useState(lunch?.room || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durMin = Math.max(15, Math.round((Number(duration) || 0) / 15) * 15);
  const canSave = !!date && !!time && durMin >= 15 && !busy;

  async function save() {
    if (!firebaseUser || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const start = snap15(combineDateTime(date, time));
      const end = new Date(start.getTime() + durMin * 60000);
      // A lunch block never counts toward hours and is never staffable.
      const base = {
        kind: 'lunch' as const,
        academyId: academy.id,
        courseId: 'lunch',
        courseName: label.trim() || 'Lunch',
        highLiability: false,
        title: '',
        start: tsFromDate(start),
        end: tsFromDate(end),
        location: '',
        room: room.trim(),
        hours: 0,
        countsTowardFdle: false,
        roleSlots: [],
        notes: '',
        updatedAt: serverTimestamp(),
      };
      if (lunch) {
        // Leaves orgId / createdBy / status untouched (orgId is immutable per rules).
        await updateDoc(doc(db, 'sessions', lunch.id), base);
        await logAudit(firebaseUser.uid, 'session.update', 'session', lunch.id, `Updated lunch block on ${date}`);
      } else {
        await addDoc(collection(db, 'sessions'), {
          ...base,
          orgId: academy.orgId,
          status: academy.status === 'draft' ? 'draft' : 'scheduled',
          createdBy: firebaseUser.uid,
        });
        await logAudit(firebaseUser.uid, 'session.create', 'session', academy.id, `Added lunch block on ${date}`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Could not save the lunch block.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!firebaseUser || !lunch) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'sessions', lunch.id));
      await logAudit(firebaseUser.uid, 'session.delete', 'session', lunch.id, 'Deleted lunch block');
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Could not delete the lunch block.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit lunch / break' : 'Add lunch / break'}>
      <p className="mb-3 text-xs text-slate-500">
        A placeholder block shown on the schedule for context. It carries no hours and is never staffed or
        signed up for. (To carve a lunch out of a class instead, use the lunch fields on a session.)
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Label">
          <Input value={label} placeholder="Lunch" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Room / location (optional)">
          <Input value={room} onChange={(e) => setRoom(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start time">
          <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Duration (min, 15-min steps)">
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        {editing ? (
          <Button variant="ghost" onClick={remove} disabled={busy} className="text-red-600 hover:bg-red-50">
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add block'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
