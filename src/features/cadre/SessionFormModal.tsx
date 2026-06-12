/**
 * CADRE — Session editor. Pick a course from the catalog (auto-fills hours +
 * default role slots), set date/time/room, adjust slot counts & required
 * qualifications. Used for both create and edit.
 */
import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { shortId, useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { combineDateTime, hoursBetween, toDateInputValue, toTimeInputValue, tsFromDate } from '../../lib/time';
import type { AcademyDoc, CourseDoc, QualificationKey, RoleSlot, SessionDoc, SlotRole } from '../../types';
import { QUALIFICATION_LABELS, SLOT_ROLE_LABELS } from '../../types';
import { Button, Field, Input, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

interface Props {
  academy: WithId<AcademyDoc>;
  /** Existing session to edit, or null to create. */
  session: WithId<SessionDoc> | null;
  onClose: () => void;
}

export function SessionFormModal({ academy, session, onClose }: Props) {
  const { firebaseUser } = useAuth();
  const { data: courses } = useCollection<CourseDoc>('courseCatalog');

  const [courseId, setCourseId] = useState(session?.courseId ?? '');
  const [title, setTitle] = useState(session?.title ?? '');
  const [date, setDate] = useState(session ? toDateInputValue(session.start.toDate()) : '');
  const [startTime, setStartTime] = useState(session ? toTimeInputValue(session.start.toDate()) : '08:00');
  const [endTime, setEndTime] = useState(session ? toTimeInputValue(session.end.toDate()) : '17:00');
  const [room, setRoom] = useState(session?.room ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [slots, setSlots] = useState<RoleSlot[]>(session?.roleSlots ?? []);
  const [busy, setBusy] = useState(false);

  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  /** Selecting a course auto-fills its default role slots (create mode only). */
  function pickCourse(id: string) {
    setCourseId(id);
    const c = courses.find((x) => x.id === id);
    if (c && !session) {
      const defaults: RoleSlot[] = [
        {
          slotId: shortId(),
          role: 'lead',
          count: 1,
          requiredQualificationKey: c.leadRequiredQualificationKey,
          filledBy: [],
        },
        ...c.defaultRoleSlots
          .filter((s) => s.role !== 'lead')
          .map((s) => ({ slotId: shortId(), filledBy: [], ...s })),
      ];
      setSlots(defaults);
    }
  }

  function updateSlot(slotId: string, patch: Partial<RoleSlot>) {
    setSlots((prev) => prev.map((s) => (s.slotId === slotId ? { ...s, ...patch } : s)));
  }

  function addSlot() {
    setSlots((prev) => [...prev, { slotId: shortId(), role: 'assistant', count: 1, filledBy: [] }]);
  }

  function removeSlot(slotId: string) {
    setSlots((prev) => prev.filter((s) => s.slotId !== slotId));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!course || !firebaseUser) return;
    setBusy(true);
    const start = combineDateTime(date, startTime);
    const end = combineDateTime(date, endTime);
    const payload = {
      academyId: academy.id,
      courseId: course.id,
      courseName: course.name,
      highLiability: course.highLiability,
      title: title || '',
      start: tsFromDate(start),
      end: tsFromDate(end),
      location: academy.location,
      room,
      hours: hoursBetween(start, end),
      roleSlots: slots,
      notes,
      updatedAt: serverTimestamp(),
    };
    if (session) {
      await updateDoc(doc(db, 'sessions', session.id), payload);
      await logAudit(firebaseUser.uid, 'session.update', 'session', session.id, `Updated ${course.name} on ${date}`);
    } else {
      const ref = await addDoc(collection(db, 'sessions'), {
        ...payload,
        status: academy.status === 'draft' ? 'draft' : 'open',
        createdBy: firebaseUser.uid,
      });
      await logAudit(firebaseUser.uid, 'session.create', 'session', ref.id, `Scheduled ${course.name} on ${date}`);
    }
    setBusy(false);
    onClose();
  }

  async function cancelSession() {
    if (!session || !firebaseUser) return;
    if (!window.confirm('Cancel this session? Signed-up instructors will be notified by Gjallarhorn.')) return;
    await updateDoc(doc(db, 'sessions', session.id), { status: 'cancelled', updatedAt: serverTimestamp() });
    await logAudit(firebaseUser.uid, 'session.cancel', 'session', session.id, `Cancelled ${session.courseName}`);
    onClose();
  }

  async function deleteSession() {
    if (!session || !firebaseUser) return;
    if (session.roleSlots.some((s) => s.filledBy.length > 0)) {
      window.alert('This session has sign-ups — cancel it instead of deleting so instructors are notified.');
      return;
    }
    if (!window.confirm('Permanently delete this (unstaffed) session?')) return;
    await deleteDoc(doc(db, 'sessions', session.id));
    await logAudit(firebaseUser.uid, 'session.delete', 'session', session.id, `Deleted ${session.courseName}`);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={session ? 'Edit session' : 'Add session'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course (from catalog)">
            <Select value={courseId} onChange={(e) => pickCourse(e.target.value)} required>
              <option value="">Select a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.defaultHours} hrs{c.highLiability ? ', high-liability' : ''})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title override (optional)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={course?.name ?? ''} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Start">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="End">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
          <Field label="Room">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} required placeholder="Rm 114 / Range A" />
          </Field>
        </div>

        <fieldset className="rounded-md border border-watch-100 p-3">
          <legend className="px-1 text-sm font-medium text-watch-800">Role slots</legend>
          <div className="space-y-2">
            {slots.map((slot) => (
              <div key={slot.slotId} className="grid grid-cols-[1fr_5rem_1fr_2rem] items-center gap-2">
                <Select value={slot.role} onChange={(e) => updateSlot(slot.slotId, { role: e.target.value as SlotRole })}>
                  {(Object.keys(SLOT_ROLE_LABELS) as SlotRole[]).map((r) => (
                    <option key={r} value={r}>
                      {SLOT_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={Math.max(1, slot.filledBy.length)}
                  value={slot.count}
                  aria-label="Slot count"
                  onChange={(e) => updateSlot(slot.slotId, { count: Number(e.target.value) })}
                />
                <Select
                  value={slot.requiredQualificationKey ?? ''}
                  aria-label="Required qualification"
                  onChange={(e) =>
                    updateSlot(slot.slotId, {
                      requiredQualificationKey: (e.target.value || undefined) as QualificationKey | undefined,
                    })
                  }
                >
                  <option value="">No qualification required</option>
                  {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((k) => (
                    <option key={k} value={k}>
                      {QUALIFICATION_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-label="Remove slot"
                  className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                  disabled={slot.filledBy.length > 0}
                  title={slot.filledBy.length > 0 ? 'Slot has sign-ups' : 'Remove slot'}
                  onClick={() => removeSlot(slot.slotId)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-2" onClick={addSlot}>
            + Add slot
          </Button>
        </fieldset>

        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {session && session.status !== 'cancelled' && (
              <Button type="button" variant="danger" onClick={cancelSession}>
                Cancel session
              </Button>
            )}
            {session && (
              <Button type="button" variant="ghost" onClick={deleteSession}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !courseId}>
              {session ? 'Save changes' : 'Add session'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
