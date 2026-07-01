/**
 * Browse Open Sessions — upcoming published sessions with unfilled slots the
 * signed-in instructor qualifies for, with one-click sign-up.
 */
import React, { useMemo, useState } from 'react';
import { orderBy, Timestamp, where } from 'firebase/firestore';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { can } from '../../lib/rbac';
import { fmtRange } from '../../lib/time';
import type { AcademyDoc, SessionDoc } from '../../types';
import { SLOT_ROLE_LABELS, QUALIFICATION_LABELS, activeVerifiedQualKeys } from '../../types';
import { Badge, Button, EmptyState, HighLiabilityBadge, PageHeader } from '../../components/ui';
import { SessionDetailModal } from '../sessions/SessionDetailModal';
import { signUpForSlot, SignupError } from '../sessions/useSignup';

export function BrowseOpenSessionsPage() {
  const { firebaseUser, profile, role, orgId } = useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const { data: sessions } = useCollection<SessionDoc>(
    'sessions',
    [where('status', '==', 'open'), where('start', '>=', Timestamp.now()), orderBy('start')],
    []
  );
  // Non-staff may only read academies in these statuses, and the list-rule
  // analyzer must SEE the constraint in the query — an unconstrained list is
  // permission-denied outright for instructors/guests (empty academy dropdown).
  const { data: academies } = useCollection<AcademyDoc>('academies', [
    where('status', 'in', ['published', 'in_progress', 'completed']),
  ]);
  const [academyFilter, setAcademyFilter] = useState('all');
  const [showUnavailable, setShowUnavailable] = useState(false);
  // Days the user marked unavailable (Profile → Unavailable days) — hidden unless toggled.
  const blackout = useMemo(() => new Set(profile?.unavailableDates ?? []), [profile]);
  const academyLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of academies) m.set(a.id, a.shortName || a.name);
    return m;
  }, [academies]);

  // Verified quals that currently count — expired instructor certs drop out
  // (Role Player never expires).
  const myQuals = useMemo(() => new Set(profile ? activeVerifiedQualKeys(profile) : []), [profile]);

  /** Sessions with at least one open slot this user can fill. */
  const matches = useMemo(
    () =>
      sessions
        .filter((s) => {
          if (academyFilter !== 'all' && s.academyId !== academyFilter) return false;
          if (!showUnavailable) {
            const d = s.start.toDate();
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (blackout.has(key)) return false;
          }
          return true;
        })
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
    [sessions, myQuals, firebaseUser?.uid, academyFilter, blackout, showUnavailable]
  );

  async function quickSignup(sessionId: string, slotId: string) {
    if (!firebaseUser) return;
    setMessage(null);
    setBusySlot(`${sessionId}:${slotId}`);
    try {
      await signUpForSlot(firebaseUser.uid, sessionId, slotId, { orgId: orgId ?? undefined });
      setMessage('Signed up — confirmation will arrive from Gjallarhorn.');
    } catch (err) {
      setMessage(err instanceof SignupError ? err.message : 'Sign-up failed.');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Instructor"
        title="Browse Open Sessions"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-watch-800">
              Academy
              <select
                className="rounded-md border border-watch-200 bg-white px-2 py-1.5 text-sm"
                value={academyFilter}
                onChange={(e) => setAcademyFilter(e.target.value)}
              >
                <option value="all">All</option>
                {academies
                  .filter((a) => a.status === 'published' || a.status === 'in_progress')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.shortName || a.name}
                    </option>
                  ))}
              </select>
            </label>
            {blackout.size > 0 && (
              <label className="flex items-center gap-2 text-sm text-watch-700">
                <input type="checkbox" checked={showUnavailable} onChange={(e) => setShowUnavailable(e.target.checked)} />
                Show my unavailable days
              </label>
            )}
          </div>
        }
      />
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
                    <span className="mr-2 rounded bg-watch-100 px-1.5 py-0.5 text-xs font-bold text-watch-800">
                      {academyLabel.get(session.academyId) ?? 'Academy'}
                    </span>
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
                    {can.signUp(role) && (
                      <Button
                        variant="primary"
                        disabled={busySlot === `${session.id}:${slot.slotId}`}
                        onClick={() => quickSignup(session.id, slot.slotId)}
                      >
                        Sign up
                      </Button>
                    )}
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
