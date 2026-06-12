/**
 * My Schedule — confirmed upcoming assignments with .ics export and withdraw.
 */
import React, { useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { downloadIcs } from '../../lib/ics';
import { fmtRange } from '../../lib/time';
import type { AssignmentDoc } from '../../types';
import { SLOT_ROLE_LABELS } from '../../types';
import { Button, EmptyState, PageHeader } from '../../components/ui';
import { withdrawFromSession } from '../sessions/useSignup';
import { SessionDetailModal } from '../sessions/SessionDetailModal';

export function MySchedulePage() {
  const { firebaseUser } = useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: assignments } = useCollection<AssignmentDoc>(
    firebaseUser ? 'assignments' : null,
    [where('uid', '==', firebaseUser?.uid ?? ''), where('status', '==', 'confirmed'), orderBy('start')],
    [firebaseUser?.uid]
  );
  const upcoming = assignments.filter((a) => a.end.toMillis() > Date.now());
  const past = assignments.filter((a) => a.end.toMillis() <= Date.now());

  async function withdraw(sessionId: string) {
    if (!firebaseUser) return;
    if (!window.confirm('Withdraw from this session? The coordinators will be notified.')) return;
    setBusy(sessionId);
    try {
      await withdrawFromSession(firebaseUser.uid, sessionId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Instructor"
        title="My Schedule"
        actions={
          <Button onClick={() => downloadIcs('heimdall-my-schedule', upcoming)} disabled={upcoming.length === 0}>
            Export .ics
          </Button>
        }
      />

      {upcoming.length === 0 ? (
        <EmptyState title="No upcoming assignments" body="Sign up for sessions under Browse Open Sessions." />
      ) : (
        <ul className="space-y-3">
          {upcoming.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
              <div>
                <button className="text-left font-semibold text-watch-900 hover:underline" onClick={() => setDetailId(a.sessionId)}>
                  {a.courseName}
                </button>
                <div className="text-sm text-slate-500">
                  {fmtRange(a.start, a.end)} · {a.location}
                  {a.room ? ` — ${a.room}` : ''} · {SLOT_ROLE_LABELS[a.role]}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => downloadIcs(`heimdall-${a.courseName.toLowerCase().replace(/\W+/g, '-')}`, [a])}>
                  .ics
                </Button>
                <Button variant="danger" disabled={busy === a.sessionId} onClick={() => withdraw(a.sessionId)}>
                  Withdraw
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-watch-600">Past assignments</h2>
          <ul className="divide-y divide-watch-50 rounded-lg border border-watch-100 bg-white shadow-sm">
            {past.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-watch-800">{a.courseName}</span>
                <span className="text-slate-400">{fmtRange(a.start, a.end)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
