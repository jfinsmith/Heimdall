/**
 * Past-session corrections — "record who actually taught". Once a session's day
 * has passed it is FINALIZED: class details (times, course, room) are locked and
 * sign-ups are closed. What remains editable is the as-taught staffing record,
 * because ATMS tracking must reflect reality:
 *   - remove a no-show who never withdrew,
 *   - add the org instructor who stepped in (their signup/assignment records
 *     update too, so their own taught history stays correct),
 *   - add a WRITE-IN for someone without an account (outside helper).
 * Every correction is audit-logged. Capacity is a scheduling concept — the
 * as-taught record may exceed the planned slot count.
 */
import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { SessionDoc, SlotRole, UserDoc } from '../../types';
import { SLOT_ROLE_LABELS } from '../../types';
import { Badge, Button, Field, Input, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { missingInstructorRecord } from './sessionEvents';
import { lastFirst } from './roster/rosterShared';
import { logAudit } from '../sessions/audit';

const WRITE_IN_ROLES: SlotRole[] = ['lead', 'assistant', 'safety_officer', 'role_player'];

export function PastSessionModal({ session, onClose }: { session: WithId<SessionDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  // Live subscription so each correction is reflected immediately.
  const { data: liveDoc } = useDoc<SessionDoc>(`sessions/${session.id}`);
  const s: WithId<SessionDoc> = liveDoc ? { ...liveDoc, id: session.id } : session;

  const { data: users } = useCollection<UserDoc>('users', [where('status', '==', 'active')]);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => lastFirst(a.displayName).localeCompare(lastFirst(b.displayName))),
    [users]
  );
  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.displayName ?? uid;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addPick, setAddPick] = useState<Record<string, string>>({}); // slotId → uid
  const [wName, setWName] = useState('');
  const [wRole, setWRole] = useState<SlotRole>('lead');

  const when = `${s.start.toDate().toLocaleDateString()} ${s.start.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${s.end.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const gap = missingInstructorRecord(s);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The correction could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  /** Remove a no-show: pull from the slot, mark their signup + assignment withdrawn. */
  function removeUid(slotId: string, uid: string) {
    return run(async () => {
      const newSlots = s.roleSlots.map((sl) => (sl.slotId === slotId ? { ...sl, filledBy: sl.filledBy.filter((u) => u !== uid) } : sl));
      await updateDoc(doc(db, 'sessions', s.id), { roleSlots: newSlots, updatedAt: serverTimestamp() });
      await setDoc(doc(db, 'sessions', s.id, 'signups', uid), { status: 'withdrawn' }, { merge: true });
      try { await updateDoc(doc(db, 'assignments', `${s.id}_${uid}`), { status: 'withdrawn' }); } catch { /* no assignment doc — fine */ }
      await logAudit(firebaseUser!.uid, 'session.correction', 'session', s.id, `As-taught correction: removed ${nameOf(uid)} (did not teach) — ${s.courseName} ${when}`);
    });
  }

  /** Add the instructor who actually taught: fill the slot + create their signup/assignment. */
  function addUid(slotId: string) {
    const uid = addPick[slotId];
    if (!uid || !firebaseUser) return;
    const slot = s.roleSlots.find((sl) => sl.slotId === slotId);
    if (!slot || slot.filledBy.includes(uid)) return;
    return run(async () => {
      const newSlots = s.roleSlots.map((sl) => (sl.slotId === slotId ? { ...sl, filledBy: [...sl.filledBy, uid] } : sl));
      await updateDoc(doc(db, 'sessions', s.id), { roleSlots: newSlots, updatedAt: serverTimestamp() });
      const now = Timestamp.now();
      await setDoc(doc(db, 'sessions', s.id, 'signups', uid), {
        uid,
        orgId: s.orgId,
        displayName: nameOf(uid),
        role: slot.role,
        slotId,
        status: 'confirmed',
        signedUpAt: now,
      });
      await setDoc(doc(db, 'assignments', `${s.id}_${uid}`), {
        uid,
        orgId: s.orgId,
        sessionId: s.id,
        academyId: s.academyId,
        role: slot.role,
        courseName: s.courseName,
        location: s.location ?? '',
        room: s.room ?? '',
        start: s.start,
        end: s.end,
        status: 'confirmed',
        reminderSent: true, // the day already happened — never remind
        createdAt: now,
      });
      setAddPick((p) => ({ ...p, [slotId]: '' }));
      await logAudit(firebaseUser.uid, 'session.correction', 'session', s.id, `As-taught correction: added ${nameOf(uid)} (${SLOT_ROLE_LABELS[slot.role]}) — ${s.courseName} ${when}`);
    });
  }

  function addWriteIn() {
    const name = wName.trim();
    if (!name || !firebaseUser) return;
    return run(async () => {
      await updateDoc(doc(db, 'sessions', s.id), {
        writeInInstructors: [...(s.writeInInstructors ?? []), { name, role: wRole }],
        updatedAt: serverTimestamp(),
      });
      setWName('');
      await logAudit(firebaseUser.uid, 'session.correction', 'session', s.id, `As-taught correction: write-in ${name} (${SLOT_ROLE_LABELS[wRole]}) — ${s.courseName} ${when}`);
    });
  }

  function removeWriteIn(index: number) {
    const w = (s.writeInInstructors ?? [])[index];
    if (!w || !firebaseUser) return;
    return run(async () => {
      await updateDoc(doc(db, 'sessions', s.id), {
        writeInInstructors: (s.writeInInstructors ?? []).filter((_, i) => i !== index),
        updatedAt: serverTimestamp(),
      });
      await logAudit(firebaseUser.uid, 'session.correction', 'session', s.id, `As-taught correction: removed write-in ${w.name} — ${s.courseName} ${when}`);
    });
  }

  return (
    <Modal open onClose={onClose} title={`Record who taught — ${s.title || s.courseName}`} wide>
      <div className="space-y-4">
        <div className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
          <span className="font-semibold text-watch-800">{when}</span>
          {s.room ? <> · {s.room}</> : null} · {s.hours} hrs
          <div className="mt-1 text-xs">
            This day has passed, so the class details are <strong>finalized</strong> — times, course, and rooms are
            locked, and sign-ups are closed. What you record here is the official <strong>as-taught</strong> staffing
            for ATMS: remove anyone who didn&apos;t show, and add whoever actually taught.
          </div>
        </div>

        {gap && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            ⚠ No lead instructor is recorded for this session — add who taught below so the record reflects what happened.
          </div>
        )}
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        {s.roleSlots.map((slot) => (
          <div key={slot.slotId} className="rounded-md border border-watch-100 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-medium text-watch-900">{SLOT_ROLE_LABELS[slot.role]}</span>
              <span className="text-xs text-slate-400">{slot.filledBy.length} recorded (planned {slot.count})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {slot.filledBy.length === 0 && <span className="text-xs text-slate-400">no one recorded</span>}
              {slot.filledBy.map((uid) => (
                <Badge key={uid} tone="green">
                  {nameOf(uid)}
                  <button
                    className="ml-1.5 text-green-900/60 hover:text-red-700"
                    disabled={busy}
                    onClick={() => removeUid(slot.slotId, uid)}
                    title="Did not teach — remove from the record"
                    aria-label={`Remove ${nameOf(uid)}`}
                  >
                    ✕
                  </button>
                </Badge>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Select
                value={addPick[slot.slotId] ?? ''}
                onChange={(e) => setAddPick((p) => ({ ...p, [slot.slotId]: e.target.value }))}
                className="max-w-xs"
                aria-label={`Add ${SLOT_ROLE_LABELS[slot.role]}`}
              >
                <option value="">— add who taught —</option>
                {sortedUsers
                  .filter((u) => !slot.filledBy.includes(u.id))
                  .map((u) => <option key={u.id} value={u.id}>{lastFirst(u.displayName)}</option>)}
              </Select>
              <Button variant="ghost" disabled={busy || !addPick[slot.slotId]} onClick={() => addUid(slot.slotId)}>
                Add
              </Button>
            </div>
          </div>
        ))}

        {/* Write-ins: people without accounts */}
        <div className="rounded-md border border-watch-100 p-3">
          <div className="mb-1 font-medium text-watch-900">Write-in instructors</div>
          <p className="mb-2 text-xs text-slate-500">
            For someone who helped but has no account here (an outside agency instructor, a guest). Write-ins print on
            the attendance and sign-in rosters alongside everyone else.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(s.writeInInstructors ?? []).map((w, i) => (
              <Badge key={`${w.name}-${i}`} tone="navy">
                {w.name} · {SLOT_ROLE_LABELS[w.role]}
                <button
                  className="ml-1.5 text-watch-100/70 hover:text-red-300"
                  disabled={busy}
                  onClick={() => removeWriteIn(i)}
                  aria-label={`Remove write-in ${w.name}`}
                >
                  ✕
                </button>
              </Badge>
            ))}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Name">
              <Input value={wName} onChange={(e) => setWName(e.target.value)} placeholder="e.g. Sgt. Dana Cole (HCSO)" />
            </Field>
            <Field label="Role">
              <Select value={wRole} onChange={(e) => setWRole(e.target.value as SlotRole)}>
                {WRITE_IN_ROLES.map((r) => <option key={r} value={r}>{SLOT_ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" disabled={busy || !wName.trim()} onClick={addWriteIn}>Add write-in</Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
