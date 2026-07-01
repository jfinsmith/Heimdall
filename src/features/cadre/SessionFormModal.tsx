/**
 * CADRE — Session editor. Pick a course from the catalog (auto-fills hours +
 * default role slots) or add a CUSTOM agency assignment (PSO assignment,
 * resiliency day, …) that does not count toward FDLE hours and defaults to a
 * single pre-assigned coordinator slot. Coordinator slots carry an assignee
 * picker (defaulting to the academy's #1 coordinator) — no open registration
 * needed for those blocks.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, deleteField, doc, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db, functions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { shortId, useCollection, type WithId } from '../../lib/firestore';
import { useCurriculum } from '../../lib/curricula';
import { useClickOutside } from '../../lib/useClickOutside';
import { useAuth } from '../../auth/AuthContext';
import { combineDateTime, hoursBetween, toDateInputValue, toTimeInputValue, tsFromDate, isValidDuration, END_BEFORE_START_MSG } from '../../lib/time';
import type { AcademyDoc, QualificationKey, RoleSlot, RoomCategoryDoc, RoomDoc, RosterMemberDoc, SessionDoc, SlotRole, UserDoc } from '../../types';
import { QUALIFICATION_LABELS, SLOT_ROLE_LABELS, SELECTABLE_SLOT_ROLES, instructorCertActive, isInstructorQual } from '../../types';
import { Button, Field, Input, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { BlockModeToggle } from './blockMode';
import { instructorCount, requiredInstructors } from './instructorRatio';
import { logAudit } from '../sessions/audit';
import { RoomSelect } from './rooms/RoomSelect';
import { findRoomConflict } from './rooms/roomBooking';

const CUSTOM = '__custom__';

// Server-side cross-session double-booking check — clients can't query other
// users' assignments, so the reserve picker asks the server before reserving.
const checkConflictFn = httpsCallable<
  { uid: string; startMs: number; endMs: number; excludeSessionId?: string },
  { conflict: boolean; courseName?: string }
>(functions, 'checkInstructorConflict');

/**
 * Type-ahead reserve picker — replaces a long instructor dropdown. Typing a name
 * filters the eligible list down to matches; clicking one reserves them.
 */
function ReserveSearch({
  options,
  onSelect,
}: {
  options: { id: string; displayName: string }[];
  onSelect: (uid: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const needle = q.trim().toLowerCase();
  const matches = options.filter((o) => o.displayName.toLowerCase().includes(needle)).slice(0, 8);

  return (
    <div className="relative" ref={ref}>
      <input
        className="w-48 rounded border border-watch-200 px-1.5 py-1 text-xs focus:border-bifrost-400 focus:outline-none focus:ring-1 focus:ring-bifrost-400"
        placeholder="+ Reserve instructor…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-watch-200 bg-white py-1 text-xs shadow-lg">
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-slate-400">{options.length === 0 ? 'No eligible instructors' : 'No matches'}</li>
          )}
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left text-slate-700 hover:bg-bifrost-50"
                onClick={() => {
                  onSelect(o.id);
                  setQ('');
                  setOpen(false);
                }}
              >
                {o.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  academy: WithId<AcademyDoc>;
  /** Existing session to edit, or null to create. */
  session: WithId<SessionDoc> | null;
  /** Prefill date (yyyy-mm-dd) when adding from a calendar day. */
  defaultDate?: string;
  /** Prefill start time (HH:MM) when adding from a clicked time slot. */
  defaultTime?: string;
  /** Shown only when creating — switch this dialog to the Add-lunch form. */
  onSwitchToLunch?: () => void;
  onClose: () => void;
}

export function SessionFormModal({ academy, session, defaultDate, defaultTime, onSwitchToLunch, onClose }: Props) {
  const { firebaseUser } = useAuth();
  // The course picker comes entirely from THIS academy's discipline — its
  // curriculum (Admin → Curriculum & Hours), which carries the hours,
  // high-liability flag, lead qualification, and default staffing slots. There's
  // no separate catalog; anything off-curriculum goes through "Custom".
  // Alphabetical for easy scanning.
  const { data: curriculum } = useCurriculum(academy.discipline);
  const courseOptions = useMemo(
    () =>
      (curriculum?.courses ?? [])
        .map((b) => ({
          value: `block:${b.name}`,
          name: b.name,
          hours: b.minHours,
          highLiability: !!b.highLiability,
          leadQualification: b.leadQualification,
          defaultRoleSlots: b.defaultRoleSlots ?? [],
          coordinatorRun: !!b.coordinatorRun,
          instructorRatio: b.instructorRatio,
        }))
        .sort((a, c) => a.name.localeCompare(c.name)),
    [curriculum]
  );
  const { data: coordinatorUsers } = useCollection<UserDoc>('users', [where('role', '==', 'coordinator')]);
  // Everyone who could be reserved into a slot in advance (any active user).
  const { data: activeUsers } = useCollection<UserDoc>('users', [where('status', '==', 'active')]);
  // Roster headcount for the FDLE instructor-ratio check (real academies only).
  const { data: rosterMembers } = useCollection<RosterMemberDoc>(
    academy.id && !academy.isTemplate ? `academies/${academy.id}/roster` : null,
    [],
    [academy.id]
  );
  const classSize = rosterMembers.filter((m) => m.status !== 'withdrawn' && !m.blockTaker).length;

  const userName = (uid: string) =>
    activeUsers.find((u) => u.id === uid)?.displayName ?? coordinatorUsers.find((u) => u.id === uid)?.displayName ?? uid;

  const isCustomSession = session ? session.courseId === 'custom' : false;
  const [courseId, setCourseId] = useState(isCustomSession ? CUSTOM : '');
  const [customName, setCustomName] = useState(isCustomSession ? session?.courseName ?? '' : '');
  const [date, setDate] = useState(session ? toDateInputValue(session.start.toDate()) : defaultDate ?? '');
  // New sessions default to a 07:00–18:00 academy day.
  const [startTime, setStartTime] = useState(session ? toTimeInputValue(session.start.toDate()) : defaultTime || '07:00');
  const [endTime, setEndTime] = useState(session ? toTimeInputValue(session.end.toDate()) : '18:00');
  const [lunchMinutes, setLunchMinutes] = useState<number>(session?.lunchMinutes ?? 0);
  // Default to noon — use || so a saved empty string (lunch was 0) still defaults to 12:00.
  const [lunchStart, setLunchStart] = useState<string>(session?.lunchStart || '12:00');
  const [lunchCounts, setLunchCounts] = useState<boolean>(session?.lunchCountsTowardHours ?? false);
  // For a multi-room session, session.room is the already comma-JOINED display
  // ("SIM, E-120") — keep only the primary segment or re-saving would re-append
  // the extras ("SIM, E-120, E-120", growing every save).
  const [room, setRoom] = useState(() => {
    const raw = session?.room ?? academy.defaultRoom ?? '';
    return session?.roomIds?.length ? raw.split(', ')[0] : raw;
  });
  const [roomId, setRoomId] = useState<string | undefined>(session?.roomId ?? academy.defaultRoomId);
  const [location, setLocation] = useState(session?.location ?? academy.location);
  // Picking a managed room auto-fills the location from that room's category and
  // locks the field; a custom/no room leaves location free-text.
  const { data: allRooms } = useCollection<RoomDoc>('rooms');
  const { data: roomCats } = useCollection<RoomCategoryDoc>('roomCategories');
  const nameOf = (id: string) => allRooms.find((r) => r.id === id)?.name ?? '';
  // Additional managed rooms beyond the primary (scenario days). The primary is
  // roomId; roomIds[] stores all of them so every room is conflict-checked.
  // Everything in roomIds except the managed primary — NOT slice(1): with a
  // custom (free-text) primary, roomIds holds only the extras, so slice(1)
  // would silently drop the first one.
  const [extraRoomIds, setExtraRoomIds] = useState<string[]>(() =>
    (session?.roomIds ?? []).filter((id) => id !== session?.roomId)
  );
  const addExtraRoom = () => setExtraRoomIds((p) => [...p, '']);
  const updateExtraRoom = (i: number, id: string | undefined) => setExtraRoomIds((p) => p.map((x, j) => (j === i ? (id ?? '') : x)));
  const removeExtraRoom = (i: number) => setExtraRoomIds((p) => p.filter((_, j) => j !== i));
  const roomLocation = useMemo(() => {
    if (!roomId) return undefined;
    const r = allRooms.find((x) => x.id === roomId);
    const cat = r && roomCats.find((k) => k.id === r.categoryId);
    return cat?.name;
  }, [roomId, allRooms, roomCats]);
  const locationLocked = !!roomId && roomLocation != null;
  const effectiveLocation = locationLocked ? roomLocation! : location;
  // All org academies — for room-conflict template exclusion + holder labels.
  const { data: academies } = useCollection<AcademyDoc>('academies');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [slots, setSlots] = useState<RoleSlot[]>(session?.roleSlots ?? []);
  const [countsTowardFdle, setCountsTowardFdle] = useState(session?.countsTowardFdle !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = courseId === CUSTOM;
  const selectedOption = useMemo(() => courseOptions.find((o) => o.value === courseId), [courseOptions, courseId]);

  // FDLE instructor ratio (1 instructor per N cadets). Counts true instructor
  // slots (lead/assistant/safety officer). Not enforced — some days need fewer.
  const ratio = selectedOption?.instructorRatio;
  const instructorSlotCount = instructorCount(slots, 'planned');
  const ratioRequired = requiredInstructors(ratio, classSize);
  const ratioMet = ratioRequired === 0 || instructorSlotCount >= ratioRequired;

  // On edit, match the saved session to a curriculum option by name (handles
  // sessions saved before the picker became curriculum-driven).
  useEffect(() => {
    if (isCustomSession || courseId || !session) return;
    const opt = courseOptions.find((o) => o.name === session.courseName);
    if (opt) setCourseId(opt.value);
  }, [courseOptions, session, isCustomSession, courseId]);
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
    setCountsTowardFdle(true); // a curriculum course always counts toward program hours
    const opt = courseOptions.find((o) => o.value === id);
    if (opt?.coordinatorRun) {
      // Coordinator-run block (orientation, equipment issue…): pre-assigned, no open sign-up.
      setSlots([coordinatorSlot()]);
      return;
    }
    setSlots([
      { slotId: shortId(), role: 'lead', count: 1, requiredQualificationKey: opt?.leadQualification, filledBy: [] },
      ...(opt?.defaultRoleSlots ?? [])
        // 'lead' is added explicitly; 'safety_officer' is retired (don't seed new sessions with it).
        .filter((s) => s.role !== 'lead' && s.role !== 'safety_officer')
        .map((s) => ({ slotId: shortId(), filledBy: [], ...s })),
    ]);
  }

  function updateSlot(slotId: string, patch: Partial<RoleSlot>) {
    setSlots((prev) => prev.map((s) => (s.slotId === slotId ? { ...s, ...patch } : s)));
  }

  /** Reserve a specific instructor into a slot (up to its count). Blocks a
   *  cross-session double-booking via the server (the cert gate is in eligibleFor). */
  async function reserve(slotId: string, uid: string) {
    if (!uid) return;
    setError(null);
    if (date && startTime && endTime) {
      try {
        const start = combineDateTime(date, startTime);
        const end = combineDateTime(date, endTime);
        const r = await checkConflictFn({ uid, startMs: start.getTime(), endMs: end.getTime(), excludeSessionId: session?.id });
        if (r.data.conflict) {
          setError(`${userName(uid)} is already assigned to ${r.data.courseName || 'another session'} during this time. Pick another instructor or time.`);
          return;
        }
      } catch {
        /* check unavailable (offline) — allow the reserve; the cert gate still applies and a real conflict still surfaces server-side at self-signup */
      }
    }
    setSlots((prev) =>
      prev.map((s) =>
        s.slotId === slotId && s.filledBy.length < s.count && !s.filledBy.includes(uid)
          ? { ...s, filledBy: [...s.filledBy, uid] }
          : s
      )
    );
  }
  function unreserve(slotId: string, uid: string) {
    setSlots((prev) => prev.map((s) => (s.slotId === slotId ? { ...s, filledBy: s.filledBy.filter((u) => u !== uid) } : s)));
  }

  /** Active users eligible to fill a slot (hold the verified qualification it
   *  requires, and — for instructor slots — a CURRENT FDLE instructor cert, so a
   *  coordinator can't reserve an expired-cert instructor onto a high-liability
   *  block; the same gate self-sign-up enforces). */
  function eligibleFor(slot: RoleSlot) {
    const req = slot.requiredQualificationKey;
    const reservedAnywhere = new Set(slots.flatMap((s) => s.filledBy)); // no double-booking within the session
    return activeUsers
      .filter(
        (u) =>
          !slot.filledBy.includes(u.id) &&
          !reservedAnywhere.has(u.id) &&
          (!req || (u.verifiedQualKeys ?? []).includes(req)) &&
          (!req || !isInstructorQual(req) || instructorCertActive(u))
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
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
    setError(null);
    if (!firebaseUser) return;
    const resolvedName = isCustom ? customName.trim() : selectedOption?.name ?? session?.courseName ?? '';
    if (!isCustom && !resolvedName) {
      setError('Select a course (or a custom assignment) first.');
      return;
    }
    if (isCustom && !customName.trim()) {
      setError('Enter a name for the custom assignment.');
      return;
    }
    setBusy(true);
    const start = combineDateTime(date, startTime);
    const end = combineDateTime(date, endTime);
    // A session must have a positive duration — guard before any write so a
    // zero/negative-duration session can't be saved (it would render with a
    // null end and crash the calendar).
    if (!isValidDuration(start, end)) {
      setBusy(false);
      setError(END_BEFORE_START_MSG);
      return;
    }
    const courseName = resolvedName;

    // All managed rooms attached to this session (primary + extras), de-duped.
    const extraIds = [...new Set(extraRoomIds.filter(Boolean))].filter((id) => id !== roomId);
    const allRoomIds = roomId ? [roomId, ...extraIds] : extraIds;
    // Managed primary resolves through nameOf so a since-renamed room prints its
    // current name; custom (no roomId) keeps the free text.
    const primaryDisplay = roomId ? (nameOf(roomId) || room) : room;
    const roomDisplay = [primaryDisplay, ...extraIds.map(nameOf)].filter(Boolean).join(', ');

    // Hard block: EVERY managed room must be free over the overlapping time.
    // (Custom/free-text rooms carry no roomId and are not reserved.)
    if (allRoomIds.length && academy.orgId) {
      const templateIds = new Set(academies.filter((a) => a.isTemplate).map((a) => a.id));
      const acadName = (id: string) => academies.find((a) => a.id === id)?.shortName || 'another class';
      try {
        for (const rid of allRoomIds) {
          const conflict = await findRoomConflict({
            orgId: academy.orgId,
            roomId: rid,
            start,
            end,
            excludeSessionId: session?.id,
            isTemplate: (id) => templateIds.has(id),
            labelFor: (s) => `${acadName(s.academyId)} — ${s.title || s.courseName}`,
          });
          if (conflict) {
            setBusy(false);
            setError(`${nameOf(rid) || 'A room'} is already booked ${toTimeInputValue(conflict.start)}–${toTimeInputValue(conflict.end)} by ${conflict.label}. Choose another room or time.`);
            return;
          }
        }
      } catch {
        // A query failure (e.g. the room index still building) must never silently
        // brick Save — surface it and let the user retry rather than hang.
        setBusy(false);
        setError('Couldn’t verify room availability right now — please try again in a moment.');
        return;
      }
    }

    // Sanitize slots: Firestore rejects `undefined`, so drop the optional
    // qualification key when it isn't set (rather than writing undefined).
    const cleanSlots = slots.map((s) => {
      const out: Record<string, unknown> = {
        slotId: s.slotId,
        role: s.role,
        count: s.count,
        filledBy: s.filledBy ?? [],
      };
      if (s.requiredQualificationKey) out.requiredQualificationKey = s.requiredQualificationKey;
      return out;
    });

    const payload = {
      academyId: academy.id,
      courseId: isCustom ? 'custom' : selectedOption?.value ?? courseId,
      courseName,
      highLiability: isCustom ? false : selectedOption?.highLiability ?? session?.highLiability ?? false,
      title: '',
      start: tsFromDate(start),
      end: tsFromDate(end),
      location: effectiveLocation,
      room: roomDisplay,
      // Instructional hours exclude the lunch break — unless lunch is set to count.
      hours: Math.max(0, hoursBetween(start, end) - (lunchCounts ? 0 : lunchMinutes / 60)),
      lunchMinutes,
      lunchStart: lunchMinutes > 0 ? lunchStart : '',
      lunchCountsTowardHours: lunchCounts,
      // Custom/agency blocks are never FDLE program hours.
      countsTowardFdle: isCustom ? false : countsTowardFdle,
      roleSlots: cleanSlots,
      notes: notes ?? '',
      updatedAt: serverTimestamp(),
    };

    try {
      let sessionId = session?.id;
      if (session) {
        await updateDoc(doc(db, 'sessions', session.id), { ...payload, roomId: roomId ?? deleteField(), roomIds: allRoomIds.length ? allRoomIds : deleteField() });
        await logAudit(firebaseUser.uid, 'session.update', 'session', session.id, `Updated ${courseName} on ${date}`);
      } else {
        const ref = await addDoc(collection(db, 'sessions'), {
          ...payload,
          ...(roomId ? { roomId } : {}),
          ...(allRoomIds.length ? { roomIds: allRoomIds } : {}),
          orgId: academy.orgId,
          // Visible on the calendar once the academy is published, but sign-ups
          // stay closed until the coordinator opens the course.
          status: academy.status === 'draft' ? 'draft' : 'scheduled',
          createdBy: firebaseUser.uid,
        });
        sessionId = ref.id;
        await logAudit(firebaseUser.uid, 'session.create', 'session', ref.id, `Scheduled ${courseName} on ${date}`);
      }

      // Sync pre-assigned / reserved people (coordinators AND reserved
      // instructors) into signups + assignments so they show on My Schedule
      // and get Gjallarhorn reminders. Only newly-added uids get created and
      // un-reserved ones get removed — existing sign-ups are left untouched.
      if (sessionId) {
        const desired = new Map<string, { slotId: string; role: string }>();
        for (const slot of slots) {
          for (const uid of slot.filledBy) if (!desired.has(uid)) desired.set(uid, { slotId: slot.slotId, role: slot.role });
        }
        const prevUids = new Set<string>();
        if (session) for (const slot of session.roleSlots) for (const uid of slot.filledBy) prevUids.add(uid);
        const now = Timestamp.now();

        for (const [uid, info] of desired) {
          if (prevUids.has(uid)) continue; // unchanged
          await setDoc(doc(db, 'sessions', sessionId, 'signups', uid), {
            uid,
            orgId: academy.orgId,
            displayName: userName(uid),
            role: info.role,
            slotId: info.slotId,
            status: 'confirmed',
            signedUpAt: now,
          });
          await setDoc(doc(db, 'assignments', `${sessionId}_${uid}`), {
            uid,
            orgId: academy.orgId,
            sessionId,
            academyId: academy.id,
            role: info.role,
            courseName,
            location: effectiveLocation,
            room: roomDisplay,
            start: tsFromDate(start),
            end: tsFromDate(end),
            status: 'confirmed',
            reminderSent: false,
            createdAt: now,
          });
        }
        // Remove people who were un-reserved.
        for (const uid of prevUids) {
          if (desired.has(uid)) continue;
          await deleteDoc(doc(db, 'assignments', `${sessionId}_${uid}`)).catch(() => {});
          await deleteDoc(doc(db, 'sessions', sessionId, 'signups', uid)).catch(() => {});
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the session. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    if (!session || !firebaseUser) return;
    if (!window.confirm('Cancel this session? Signed-up instructors will be notified by Gjallarhorn.')) return;
    setError(null);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'sessions', session.id), { status: 'cancelled', updatedAt: serverTimestamp() });
      await logAudit(firebaseUser.uid, 'session.cancel', 'session', session.id, `Cancelled ${session.courseName}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the session.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession() {
    if (!session || !firebaseUser) return;
    if (session.roleSlots.some((s) => s.role !== 'coordinator' && s.filledBy.length > 0)) {
      window.alert('This session has sign-ups — cancel it instead of deleting so instructors are notified.');
      return;
    }
    if (!window.confirm('Permanently delete this session?')) return;
    setBusy(true);
    setError(null);
    try {
      // Clean up any pre-assigned coordinator mirror docs so they don't orphan.
      for (const slot of session.roleSlots) {
        for (const uid of slot.filledBy) {
          await deleteDoc(doc(db, 'assignments', `${session.id}_${uid}`)).catch(() => {});
          await deleteDoc(doc(db, 'sessions', session.id, 'signups', uid)).catch(() => {});
        }
      }
      await deleteDoc(doc(db, 'sessions', session.id));
      await logAudit(firebaseUser.uid, 'session.delete', 'session', session.id, `Deleted ${session.courseName}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={session ? 'Edit session' : 'Add to schedule'} wide>
      {!session && onSwitchToLunch && <BlockModeToggle mode="session" onLunch={onSwitchToLunch} />}
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course (required)" hint="From this academy's discipline">
            <Select value={courseId} onChange={(e) => pickCourse(e.target.value)} required>
              <option value="">Select a course…</option>
              {courseOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name} ({o.hours} hrs{o.highLiability ? ', high-liability' : ''})
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
          <Field label="Lunch (min)" hint="Default: carved out">
            <Input
              type="number"
              min={0}
              step={15}
              value={lunchMinutes}
              onChange={(e) => setLunchMinutes(Number(e.target.value))}
            />
          </Field>
        </div>
        {lunchMinutes > 0 && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Lunch starts at" className="max-w-[10rem]">
              <Input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} />
            </Field>
            <details className="mb-2 w-full">
              <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-watch-700">
                Advanced{lunchCounts && <span className="ml-1 text-amber-700">⚠ lunch counts toward hours</span>}
              </summary>
              <label className="mt-1.5 flex items-start gap-2 text-sm text-watch-800">
                <input type="checkbox" className="mt-0.5" checked={lunchCounts} onChange={(e) => setLunchCounts(e.target.checked)} />
                <span>
                  Count lunch toward instructional hours
                  <span className="block text-xs text-amber-700">⚠ Rare — FDLE: lunch must NOT count toward instructional hours except in a separately-approved case. Leave unchecked unless you have approval.</span>
                </span>
              </label>
            </details>
          </div>
        )}
        <p className="-mt-2 text-xs text-slate-500">
          Instructional hours: <strong>{Math.max(0, hoursBetween(combineDateTime(date || '2000-01-01', startTime), combineDateTime(date || '2000-01-01', endTime)) - (lunchCounts ? 0 : lunchMinutes / 60))}</strong>
          {lunchMinutes > 0 && (lunchCounts ? ` (incl. a ${lunchMinutes}-min lunch)` : ` (after a ${lunchMinutes}-min lunch)`)}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room (optional)" hint="Pick a managed room or Custom — booked rooms are blocked. Add more for scenario days.">
            <div className="space-y-2">
              <RoomSelect value={room} roomId={roomId} headcount={classSize} onChange={(name, id) => { setRoom(name); setRoomId(id); }} />
              {extraRoomIds.map((id, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1">
                    <RoomSelect value={nameOf(id)} roomId={id || undefined} headcount={classSize} onChange={(_, nid) => updateExtraRoom(i, nid)} />
                  </div>
                  <button type="button" className="mt-2 text-slate-400 hover:text-red-600" onClick={() => removeExtraRoom(i)} aria-label="Remove room">✕</button>
                </div>
              ))}
              <button type="button" className="text-xs font-medium text-bifrost-700 hover:underline" onClick={addExtraRoom}>+ Add room</button>
            </div>
          </Field>
          <Field label="Location" hint={locationLocked ? 'From the room’s location — pick Custom room to edit' : 'This day only — e.g. an off-site range'}>
            <Input value={effectiveLocation} onChange={(e) => setLocation(e.target.value)} required disabled={locationLocked} />
          </Field>
        </div>

        {isCustom ? (
          <p className="text-sm text-slate-500">
            Custom / agency block — does <strong>not</strong> count toward FDLE program hours.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-watch-800">
            <input type="checkbox" checked={countsTowardFdle} onChange={(e) => setCountsTowardFdle(e.target.checked)} />
            Counts toward FDLE program hours
            <span className="text-xs text-slate-400">(uncheck for agency-only blocks like PSO assignments)</span>
          </label>
        )}

        <fieldset className="rounded-md border border-watch-100 p-3">
          <legend className="px-1 text-sm font-medium text-watch-800">Role slots</legend>
          {ratio && classSize > 0 && (
            <div className={`mb-2 rounded-md px-2 py-1.5 text-xs ${ratioMet ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
              FDLE ratio 1:{ratio} — {classSize} cadets need <strong>{ratioRequired}</strong> instructor{ratioRequired === 1 ? '' : 's'};
              this session has <strong>{instructorSlotCount}</strong>.{' '}
              {ratioMet ? '✓ Meets ratio.' : 'Below ratio — only required on full-class days.'}
            </div>
          )}
          <div className="space-y-2">
            {slots.map((slot) => (
              <div key={slot.slotId} className="rounded-md border border-watch-100 p-2">
                <div className="grid grid-cols-[1fr_5rem_1fr_2rem] items-center gap-2">
                  <Select value={slot.role} onChange={(e) => changeSlotRole(slot, e.target.value as SlotRole)}>
                    {/* Retired roles (e.g. legacy Safety Officer) aren't offered, but a slot that
                        already holds one keeps it as an option so it still renders and can be changed. */}
                    {(SELECTABLE_SLOT_ROLES.includes(slot.role) ? [...SELECTABLE_SLOT_ROLES] : [...SELECTABLE_SLOT_ROLES, slot.role])
                      .sort((a, b) => SLOT_ROLE_LABELS[a].localeCompare(SLOT_ROLE_LABELS[b]))
                      .map((r) => (
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
                        {[...coordinatorUsers].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((u) => (
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
                        // Never below the number already reserved (`min` isn't enforced on typed input).
                        onChange={(e) =>
                          updateSlot(slot.slotId, { count: Math.max(slot.filledBy.length, Number(e.target.value) || 0) })
                        }
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
                        {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).sort((a, b) => QUALIFICATION_LABELS[a].localeCompare(QUALIFICATION_LABELS[b])).map((k) => (
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
                    disabled={slot.filledBy.length > 0}
                    title={slot.filledBy.length > 0 ? 'Clear the assigned person first' : 'Remove slot'}
                    onClick={() => setSlots((prev) => prev.filter((s) => s.slotId !== slot.slotId))}
                  >
                    ✕
                  </button>
                </div>

                {/* Reserve specific instructors for this slot (pre-assigned, no sign-up needed). */}
                {slot.role !== 'coordinator' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-0.5">
                    <span className="text-xs font-medium text-slate-500">Reserved:</span>
                    {slot.filledBy.length === 0 && (
                      <span className="text-xs text-slate-400">none — open for sign-up</span>
                    )}
                    {slot.filledBy.map((uid) => (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1 rounded-full bg-bifrost-50 px-2 py-0.5 text-xs font-medium text-bifrost-800 ring-1 ring-inset ring-bifrost-200"
                      >
                        {userName(uid)}
                        <button
                          type="button"
                          aria-label={`Unreserve ${userName(uid)}`}
                          className="text-bifrost-400 hover:text-red-600"
                          onClick={() => unreserve(slot.slotId, uid)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {slot.filledBy.length < slot.count && (
                      <ReserveSearch
                        options={eligibleFor(slot)}
                        onSelect={(uid) => void reserve(slot.slotId, uid)}
                      />
                    )}
                  </div>
                )}
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
