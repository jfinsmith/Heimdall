/**
 * Session detail modal — role slots, who's signed up, and per-slot
 * Sign Up / Withdraw actions for qualifying users.
 */
import React, { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { shortId, useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../lib/rbac';
import { fmtRange } from '../../lib/time';
import type { SessionDoc, SignupDoc } from '../../types';
import { SLOT_ROLE_LABELS, QUALIFICATION_LABELS, activeVerifiedQualKeys } from '../../types';
import { Badge, Button, HighLiabilityBadge, StatusPill } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { signUpForSlot, withdrawFromSession, SignupError } from './useSignup';
import { logAudit } from './audit';

interface Props {
  sessionId: string;
  onClose: () => void;
  /** Provided in staff contexts (builder) to jump into the editor. */
  onEdit?: (session: WithId<SessionDoc>) => void;
}

export function SessionDetailModal({ sessionId, onClose, onEdit }: Props) {
  const { firebaseUser, profile, role } = useAuth();
  const { data: session } = useDoc<SessionDoc>(`sessions/${sessionId}`);
  const { data: signups } = useCollection<SignupDoc>(
    `sessions/${sessionId}/signups`,
    [where('status', 'in', ['confirmed', 'waitlist'])],
    [sessionId]
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  const mySignup = signups.find((s) => s.uid === firebaseUser?.uid);

  function hasQual(requiredKey?: string): boolean {
    if (!requiredKey) return true;
    // Verified AND currently valid — an expired instructor cert no longer counts.
    return profile ? activeVerifiedQualKeys(profile).includes(requiredKey as never) : false;
  }

  async function doSignup(slotId: string, allowWaitlist = false) {
    if (!firebaseUser) return;
    setError(null);
    setBusy(true);
    try {
      const res = await signUpForSlot(firebaseUser.uid, sessionId, slotId, { allowWaitlist });
      if (res.status === 'waitlist') setError('Slot is full — you have been placed on the waitlist.');
    } catch (err) {
      if (err instanceof SignupError && err.message === 'FULL') {
        if (window.confirm('That slot is full. Join the waitlist instead?')) {
          await doSignup(slotId, true);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Sign-up failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function doWithdraw() {
    if (!firebaseUser) return;
    setError(null);
    setBusy(true);
    try {
      await withdrawFromSession(firebaseUser.uid, sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed.');
    } finally {
      setBusy(false);
    }
  }

  /** Copy this session's structure to the next day (fresh, unassigned slots). */
  async function duplicateToNextDay() {
    if (!session || !firebaseUser) return;
    setBusy(true);
    setError(null);
    try {
      // Advance to the next day, skipping weekends (a Friday duplicates to
      // Monday). setDate keeps the wall-clock time correct across DST.
      let dayDelta = 0;
      const probe = session.start.toDate();
      do {
        probe.setDate(probe.getDate() + 1);
        dayDelta++;
      } while (probe.getDay() === 0 || probe.getDay() === 6);
      const nextStart = session.start.toDate();
      nextStart.setDate(nextStart.getDate() + dayDelta);
      const nextEnd = session.end.toDate();
      nextEnd.setDate(nextEnd.getDate() + dayDelta);
      await addDoc(collection(db, 'sessions'), {
        academyId: session.academyId,
        courseId: session.courseId,
        courseName: session.courseName,
        highLiability: session.highLiability,
        title: session.title ?? '',
        start: Timestamp.fromDate(nextStart),
        end: Timestamp.fromDate(nextEnd),
        location: session.location,
        room: session.room ?? '',
        hours: session.hours,
        lunchMinutes: session.lunchMinutes ?? 0,
        lunchStart: session.lunchStart ?? '',
        lunchCountsTowardHours: session.lunchCountsTowardHours ?? false,
        countsTowardFdle: session.countsTowardFdle !== false,
        notes: session.notes ?? '',
        // Same slot structure, but no one carried over — staff it fresh.
        roleSlots: session.roleSlots.map((sl) => ({
          slotId: shortId(),
          role: sl.role,
          count: sl.count,
          ...(sl.requiredQualificationKey ? { requiredQualificationKey: sl.requiredQualificationKey } : {}),
          filledBy: [],
        })),
        status: session.status === 'draft' ? 'draft' : 'scheduled',
        createdBy: firebaseUser.uid,
        updatedAt: serverTimestamp(),
      });
      await logAudit(firebaseUser.uid, 'session.duplicate', 'session', sessionId, `Duplicated ${session.courseName} to ${nextStart.toLocaleDateString()}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not duplicate the session.');
    } finally {
      setBusy(false);
    }
  }

  /** Delete the session directly from the detail view (staff only), with a warning. */
  async function deleteSession() {
    if (!session || !firebaseUser) return;
    // Block deleting a session with real instructor sign-ups — cancel it instead.
    if (session.roleSlots.some((sl) => sl.role !== 'coordinator' && sl.filledBy.length > 0)) {
      window.alert('This session has instructor sign-ups — cancel it instead of deleting so they are notified.');
      return;
    }
    if (!window.confirm(`Permanently delete "${session.title || session.courseName}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      // Clean up any pre-assigned / reserved mirror docs so they don't orphan.
      for (const slot of session.roleSlots) {
        for (const uid of slot.filledBy) {
          await deleteDoc(doc(db, 'assignments', `${sessionId}_${uid}`)).catch(() => {});
          await deleteDoc(doc(db, 'sessions', sessionId, 'signups', uid)).catch(() => {});
        }
      }
      await deleteDoc(doc(db, 'sessions', sessionId));
      await logAudit(firebaseUser.uid, 'session.delete', 'session', sessionId, `Deleted ${session.courseName}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={session.title || session.courseName} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <StatusPill status={session.status} />
        {session.highLiability && <HighLiabilityBadge />}
        <span>{fmtRange(session.start, session.end)}</span>
        <span>· {session.location}{session.room ? ` — ${session.room}` : ''}</span>
        <span>· {session.hours} hrs</span>
      </div>
      {session.notes && <p className="mb-4 rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">{session.notes}</p>}
      {error && <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>}

      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Role slots</h3>
      <ul className="space-y-3">
        {session.roleSlots.map((slot) => {
          const filled = signups.filter((s) => s.slotId === slot.slotId && s.status === 'confirmed');
          const waitlisted = signups.filter((s) => s.slotId === slot.slotId && s.status === 'waitlist');
          const mineHere = mySignup?.slotId === slot.slotId;
          const qualified = hasQual(slot.requiredQualificationKey);
          const open = slot.filledBy.length < slot.count;
          return (
            <li key={slot.slotId} className="rounded-md border border-watch-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-watch-900">{SLOT_ROLE_LABELS[slot.role]}</span>
                  <span className="ml-2 text-sm text-slate-500">
                    {slot.filledBy.length}/{slot.count} filled
                  </span>
                  {slot.requiredQualificationKey && (
                    <Badge tone={qualified ? 'navy' : 'amber'}>
                      Requires {QUALIFICATION_LABELS[slot.requiredQualificationKey]}
                    </Badge>
                  )}
                </div>
                {slot.role === 'coordinator' && (
                  <span className="text-xs text-slate-400">Assigned by coordinator</span>
                )}
                {slot.role !== 'coordinator' && firebaseUser && session.status === 'scheduled' && !can.buildSchedules(role) && (
                  <span className="text-xs text-slate-400">Sign-up not open yet</span>
                )}
                {slot.role !== 'coordinator' && firebaseUser && (session.status === 'open' || session.status === 'fully_staffed') && (
                  mineHere ? (
                    <Button variant="danger" disabled={busy} onClick={doWithdraw}>
                      Withdraw
                    </Button>
                  ) : !mySignup ? (
                    <Button
                      variant="primary"
                      disabled={busy || !qualified}
                      title={!qualified ? 'You lack the verified qualification for this slot' : undefined}
                      onClick={() => doSignup(slot.slotId, !open)}
                    >
                      {open ? 'Sign up' : 'Join waitlist'}
                    </Button>
                  ) : null
                )}
              </div>
              {(filled.length > 0 || waitlisted.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-sm">
                  {filled.map((s) => (
                    <Badge key={s.uid} tone="green">{s.displayName}</Badge>
                  ))}
                  {waitlisted.map((s) => (
                    <Badge key={s.uid} tone="slate">{s.displayName} (waitlist)</Badge>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {can.buildSchedules(role) && (
        <div className="mt-4 flex justify-end gap-2 border-t border-watch-50 pt-3">
          {session.status === 'scheduled' && session.roleSlots.some((sl) => sl.role !== 'coordinator') && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  await updateDoc(doc(db, 'sessions', sessionId), { status: 'open', updatedAt: serverTimestamp() });
                  await addDoc(collection(db, 'coursePublishEvents'), {
                    academyId: session.academyId,
                    courseLabel: session.title || session.courseName,
                    sessionCount: 1,
                    requestedBy: firebaseUser?.uid ?? '',
                    createdAt: serverTimestamp(),
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not open sign-ups.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Open sign-ups
            </Button>
          )}
          {(session.status === 'open' || session.status === 'fully_staffed') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  await updateDoc(doc(db, 'sessions', sessionId), { status: 'scheduled', updatedAt: serverTimestamp() });
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not close sign-ups.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Close sign-ups
            </Button>
          )}
          {session.status !== 'cancelled' && session.status !== 'completed' && (
            <Button disabled={busy} onClick={duplicateToNextDay} title="Copy this session's structure to the next day">
              Duplicate to next day
            </Button>
          )}
          {onEdit && <Button onClick={() => onEdit(session as WithId<SessionDoc>)}>Edit session</Button>}
          {session.status !== 'cancelled' && session.status !== 'completed' && (
            <Button variant="danger" disabled={busy} onClick={deleteSession}>
              Delete
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
