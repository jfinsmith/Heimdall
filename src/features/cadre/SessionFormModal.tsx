/**
 * CADRE — Session editor. Pick a course from the catalog (auto-fills hours +
 * default role slots) or add a CUSTOM agency assignment (PSO assignment,
 * resiliency day, …) that does not count toward FDLE hours and defaults to a
 * single pre-assigned coordinator slot. Coordinator slots carry an assignee
 * picker (defaulting to the academy's #1 coordinator) — no open registration
 * needed for those blocks.
 */
import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { shortId, useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { combineDateTime, hoursBetween, toDateInputValue, toTimeInputValue, tsFromDate } from '../../lib/time';
import type { AcademyDoc, CourseDoc, QualificationKey, RoleSlot, SessionDoc, SlotRole, UserDoc } from '../../types';
import { QUALIFICATION_LABELS, SLOT_ROLE_LABELS } from '../../types';
import { Button, Field, Input, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

const CUSTOM = '__custom__';

interface Props {
  academy: WithId<AcademyDoc>;
  /** Existing session to edit, or null to create. */
  session: WithId<SessionDoc> | null;
  onClose: () => void;
}

export function SessionFormModal({ academy, session, onClose }: Props) {
  const { firebaseUser } = useAuth();
  const { data: courses } = useCollection<CourseDoc>('courseCatalog');
  const { data: coordinatorUsers } = useCollection<UserDoc>('users', [where('role', '==', 'coordinator')]);

  const isCustomSession = session ? session.courseId === 'custom' : false;
  const [courseId, setCourseId] = useState(isCustomSession ? CUSTOM : session?.courseId ?? '');
  const [customName, setCustomName] = useState(isCustomSession ? session?.courseName ?? '' : '');
  const [date, setDate] = useState(session ? toDateInputValue(session.start.toDate()) : '');
  const [startTime, setStartTime] = useState(session ? toTimeInputValue(session.start.toDate()) : '08:00');
  const [endTime, setEndTime] = useState(session ? toTimeInputValue(session.end.toDate()) : '17:00');
  const [room, setRoom] = useState(session?.room ?? academy.defaultRoom ?? '');
  const [location, setLocation] = useState(session?.location ?? academy.location);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [slots, setSlots] = useState<RoleSlot[]>(session?.roleSlots ?? []);
  const [countsTowardFdle, setCountsTowardFdle] = useState(session?.countsTowardFdle !== false);
  const [busy, setBusy] = useState(false);

  const isCustom = courseId === CUSTOM;
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);
  const defaultCoordinator = academy.coordinatorIds[0] ?? '';

  function coordinatorSlot(): RoleSlot {
    return {
      slotId: shortId(),
      role: 'coordinator',
      count: 1,
      filledBy: defaultCoordinator ? [defaultCoordinator] : [],
    };
  }

  /** Selecting a course (or Custom) sets sensible defaults (create mode only). */
  function pickCourse(id: string) {
    setCourseId(id);
    if (session) return;
    if (id === CUSTOM) {
      // Agency-specific block: coordinator owns it, hours don't count toward FDLE.
      setSlots([coordinatorSlot()]);
      setCountsTowardFdle(false);
      return;
    }
    setCountsTowardFdle(true);
    const c = courses.find((x) => x.id === id);
    if (c) {
      setSlots([
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
      ]);
    }
  }

  function updateSlot(slotId: string, patch: Partial<RoleSlot>) {
    setSlots((prev) => prev.map((s) => (s.slotId === slotId ? { ...s, ...patch } : s)));
  }

  function changeSlotRole(slot: RoleSlot, role: SlotRole) {
    if (role === 'coordinator') {
      updateSlot(slot.slotId, {
        role,
        count: 1,
        requiredQualificationKey: undefined,
        filledBy: defaultCoordinator ? [defaultCoordinator] : [],
      });
    } else if (slot.role === 'coordinator') {
      updateSlot(slot.slotId, { role, filledBy: [] }); // un-assign when leaving coordinator type
    } else {
      updateSlot(slot.slotId, { role });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser || (!course && !isCustom)) return;
    if (isCustom && !customName.trim()) return;
    setBusy(true);
    const start = combineDateTime(date, startTime);
    const end = combineDateTime(date, endTime);
    const courseName = isCustom ? customName.trim() : course!.name;
    const payload = {
      academyId: academy.id,
      courseId: isCustom ? 'custom' : course!.id,
      courseName,
      highLiability: isCustom ? false : course!.highLiability,
      title: '',
      start: tsFromDate(start),
      end: tsFromDate(end),
      location,
      room,
      hours: hoursBetween(start, end),
      countsTowardFdle,
      roleSlots: slots,
      notes,
      updatedAt: serverTimestamp(),
    };

    let sessionId = session?.id;
    if (session) {
      await updateDoc(doc(db, 'sessions', session.id), payload);
      await logAudit(firebaseUser.uid, 'session.update', 'session', session.id, `Updated ${courseName} on ${date}`);
    } else {
      const ref = await addDoc(collection(db, 'sessions'), {
        ...payload,
        // Visible on the calendar once the academy is published, but sign-ups
        // stay closed until the coordinator opens the course.
        status: academy.status === 'draft' ? 'draft' : 'scheduled',
        createdBy: firebaseUser.uid,
      });
      sessionId = ref.id;
      await logAudit(firebaseUser.uid, 'session.create', 'session', ref.id, `Scheduled ${courseName} on ${date}`);
    }

    // Mirror coordinator-slot assignments into signups/assignments so the
    // coordinator's My Schedule and Gjallarhorn reminders see them.
    for (const slot of slots) {
      if (slot.role !== 'coordinator' || !slot.filledBy[0] || !sessionId) continue;
      const uid = slot.filledBy[0];
      const u = coordinatorUsers.find((x) => x.id === uid);
      const now = Timestamp.now();
      await setDoc(doc(db, 'sessions', sessionId, 'signups', uid), {
        uid,
        displayName: u?.displayName ?? 'Coordinator',
        role: 'coordinator',
        slotId: slot.slotId,
        status: 'confirmed',
        signedUpAt: now,
      });
      await setDoc(doc(db, 'assignments', `${sessionId}_${uid}`), {
        uid,
        sessionId,
        academyId: academy.id,
        role: 'coordinator',
        courseName,
        location,
        room,
        start: tsFromDate(start),
        end: tsFromDate(end),
        status: 'confirmed',
        reminderSent: false,
        createdAt: now,
      });
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
    if (session.roleSlots.some((s) => s.role !== 'coordinator' && s.filledBy.length > 0)) {
      window.alert('This session has sign-ups — cancel it instead of deleting so instructors are notified.');
      return;
    }
    if (!window.confirm('Permanently delete this session?')) return;
    await deleteDoc(doc(db, 'sessions', session.id));
    await logAudit(firebaseUser.uid, 'session.delete', 'session', session.id, `Deleted ${session.courseName}`);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={session ? 'Edit session' : 'Add session'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course (required — from catalog)">
            <Select value={courseId} onChange={(e) => pickCourse(e.target.value)} required>
              <option value="">Select a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.defaultHours} hrs{c.highLiability ? ', high-liability' : ''})
                </option>
              ))}
              <option value={CUSTOM}>— Custom / agency assignment —</option>
            </Select>
          </Field>
          {isCustom ? (
            <Field label="Custom assignment name" hint="e.g. PSO Assignment, Academy Resiliency Training">
              <Input value={customName} onChange={(e) => setCustomName(e.target.value)} required />
            </Field>
          ) : (
            <Field
              label="Notes (shown under the title on the calendar)"
              hint='e.g. "Night driving", "Scenarios", "Test" — distinguishes same-course days'
            >
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Start">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="End">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room" hint="Prefilled from the academy default">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} required placeholder="E-120 / Range A" />
          </Field>
          <Field label="Location" hint="This day only — e.g. an off-site range">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} required />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-watch-800">
          <input type="checkbox" checked={countsTowardFdle} onChange={(e) => setCountsTowardFdle(e.target.checked)} />
          Counts toward FDLE program hours
          <span className="text-xs text-slate-400">(uncheck for agency-only blocks like PSO assignments)</span>
        </label>

        <fieldset className="rounded-md border border-watch-100 p-3">
          <legend className="px-1 text-sm font-medium text-watch-800">Role slots</legend>
          <div className="space-y-2">
            {slots.map((slot) => (
              <div key={slot.slotId} className="grid grid-cols-[1fr_5rem_1fr_2rem] items-center gap-2">
                <Select value={slot.role} onChange={(e) => changeSlotRole(slot, e.target.value as SlotRole)}>
                  {(Object.keys(SLOT_ROLE_LABELS) as SlotRole[]).map((r) => (
                    <option key={r} value={r}>
                      {SLOT_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                {slot.role === 'coordinator' ? (
                  <>
                    <span className="text-center text-xs text-slate-400">assigned</span>
                    <Select
                      value={slot.filledBy[0] ?? ''}
                      aria-label="Assigned coordinator"
                      onChange={(e) => updateSlot(slot.slotId, { filledBy: e.target.value ? [e.target.value] : [] })}
                    >
                      <option value="">Unassigned</option>
                      {coordinatorUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                          {u.id === defaultCoordinator ? ' (academy #1)' : ''}
                        </option>
                      ))}
                    </Select>
                  </>
                ) : (
                  <>
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
                  </>
                )}
                <button
                  type="button"
                  aria-label="Remove slot"
                  className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                  disabled={slot.role !== 'coordinator' && slot.filledBy.length > 0}
                  title={slot.role !== 'coordinator' && slot.filledBy.length > 0 ? 'Slot has sign-ups' : 'Remove slot'}
                  onClick={() => setSlots((prev) => prev.filter((s) => s.slotId !== slot.slotId))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            onClick={() => setSlots((prev) => [...prev, { slotId: shortId(), role: 'assistant', count: 1, filledBy: [] }])}
          >
            + Add slot
          </Button>
        </fieldset>

        {isCustom && (
          <Field label="Notes (shown under the title on the calendar)">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        )}

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
            <Button type="submit" variant="primary" disabled={busy || (!courseId && !isCustom)}>
              {session ? 'Save changes' : 'Add session'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
