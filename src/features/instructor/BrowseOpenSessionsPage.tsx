/**
 * Browse Open Sessions — upcoming published sessions with unfilled slots the
 * signed-in instructor qualifies for, with one-click sign-up.
 */
import React, { useMemo, useState } from 'react';
import { orderBy, Timestamp, where } from 'firebase/firestore';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { fmtRange } from '../../lib/time';
import type { SessionDoc } from '../../types';
import { SLOT_ROLE_LABELS, QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, EmptyState, HighLiabilityBadge, PageHeader } from '../../components/ui';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { signUpForSlot, SignupError } from '../sessions/useSignup';

export function BrowseOpenSessionsPage() {
  const { firebaseUser, profile } = useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const { data: sessions } = useCollection<SessionDoc>(
    'sessions',
    [where('status', '==', 'open'), where('start', '>=', Timestamp.now()), orderBy('start')],
    []
  );

  const myQuals = useMemo(
    () =>
      new Set(
        (profile?.qualifications ?? [])
          .filter((q) => q.verified && (!q.expires || q.expires.toMillis() > Date.now()))
          .map((q) => q.key)
      ),
    [profile]
  );

  /** Sessions with at least one open slot this user can fill. */
  const matches = useMemo(
    () =>
      sessions
        .map((s) => ({
          session: s,
          openSlots: s.roleSlots.filter(
            (slot) =>
              slot.filledBy.length < slot.count &&
              !slot.filledBy.includes(firebaseUser?.uid ?? '') &&
              (!slot.requiredQualificationKey || myQuals.has(slot.requiredQualificationKey))
          ),
        }))
        .filter((m) => m.openSlots.length > 0),
    [sessions, myQuals, firebaseUser?.uid]
  );

  async function quickSignup(sessionId: string, slotId: string) {
    if (!firebaseUser) return;
    setMessage(null);
    setBusySlot(`${sessionId}:${slotId}`);
    try {
      await signUpForSlot(firebaseUser.uid, sessionId, slotId);
      setMessage('Signed up — confirmation will arrive from Gjallarhorn.');
    } catch (err) {
      setMessage(err instanceof SignupError ? err.message : 'Sign-up failed.');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div>
      <PageHeader kicker="Instructor" title="Browse Open Sessions" />
      {message && <div className="mb-4 rounded-md bg-watch-100 px-3 py-2 text-sm text-watch-800">{message}</div>}

      {matches.length === 0 ? (
        <EmptyState
          title="No open sessions match your qualifications"
          body="Either everything is staffed, or you need a coordinator to verify additional qualifications on your profile."
        />
      ) : (
        <ul className="space-y-3">
          {matches.map(({ session, openSlots }) => (
            <li key={session.id} className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <button
                    className="text-left font-semibold text-watch-900 hover:underline"
                    onClick={() => setDetailId(session.id)}
                  >
                    {session.title || session.courseName}
                  </button>
                  <div className="text-sm text-slate-500">
                    {fmtRange(session.start, session.end)} · {session.location}
                    {session.room ? ` — ${session.room}` : ''}
                  </div>
                </div>
                {session.highLiability && <HighLiabilityBadge />}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {openSlots.map((slot) => (
                  <span key={slot.slotId} className="inline-flex items-center gap-2 rounded-md border border-watch-100 px-2 py-1.5">
                    <span className="text-sm text-watch-800">
                      {SLOT_ROLE_LABELS[slot.role]}
                      <span className="text-slate-400"> ({slot.count - slot.filledBy.length} open)</span>
                    </span>
                    {slot.requiredQualificationKey && (
                      <Badge tone="navy">{QUALIFICATION_LABELS[slot.requiredQualificationKey]}</Badge>
                    )}
                    <Button
                      variant="primary"
                      disabled={busySlot === `${session.id}:${slot.slotId}`}
                      onClick={() => quickSignup(session.id, slot.slotId)}
                    >
                      Sign up
                    </Button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
