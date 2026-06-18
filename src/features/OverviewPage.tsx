/**
 * Overview — the watchtower landing page. Role-aware: instructors see their
 * upcoming assignments + open slots; staff also see understaffing counts.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderBy, where, Timestamp, limit } from 'firebase/firestore';
import { useAuth } from '../auth/AuthContext';
import { useCollection } from '../lib/firestore';
import { can } from '../lib/rbac';
import { fmtRange } from '../lib/time';
import type { AcademyDoc, AssignmentDoc, SessionDoc } from '../types';
import { unfilledSlots } from '../types';
import { PageHeader, StatusPill, EmptyState, Spinner } from '../components/ui';
import { SessionDetailModal } from './sessions/SessionDetailModal';
import { OrgLogo } from '../brand/OrgLogo';

export function OverviewPage() {
  const { firebaseUser, profile, role } = useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const now = Timestamp.now();

  const { data: myAssignments, loading: assignmentsLoading } = useCollection<AssignmentDoc>(
    firebaseUser ? 'assignments' : null,
    [where('uid', '==', firebaseUser?.uid ?? ''), where('status', '==', 'confirmed'), orderBy('start'), limit(5)],
    [firebaseUser?.uid]
  );
  const upcoming = myAssignments.filter((a) => a.start.toMillis() >= now.toMillis() - 36e5);

  const staff = can.viewStaffing(role);
  const { data: upcomingSessions } = useCollection<SessionDoc>(
    staff ? 'sessions' : null,
    [where('start', '>=', now), orderBy('start'), limit(100)],
    [staff]
  );
  const understaffed = upcomingSessions.filter(
    (s) => (s.status === 'open' || s.status === 'draft') && unfilledSlots(s).length > 0
  );

  // Classes awaiting THIS user's sign-off in the approval chain.
  const { data: academies } = useCollection<AcademyDoc>(staff ? 'academies' : null, [], [staff]);
  const pendingMyApproval = academies.filter((a) => {
    if (a.isTemplate) return false;
    const st = a.approval?.state;
    return (
      (st === 'pending_sergeant' && a.approval?.sergeantId === firebaseUser?.uid) ||
      (st === 'pending_lieutenant' && role === 'lieutenant') ||
      (st === 'pending_captain' && role === 'director')
    );
  });

  return (
    <div>
      {/* Brand banner — the full engraved lockup on the night-watch panel */}
      <div className="mb-6 flex justify-center rounded-xl bg-watch-950 px-6 py-8 shadow-sm">
        <OrgLogo size={170} fallback="stacked" />
      </div>

      <PageHeader kicker="HEIMDALL" title={`The watch is yours, ${profile?.displayName?.split(' ')[0] ?? ''}`} />

      {pendingMyApproval.length > 0 && (
        <section className="mb-6 rounded-lg border-2 border-bifrost-200 bg-bifrost-50/40 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-bifrost-800">
            Pending your approval ({pendingMyApproval.length})
          </h2>
          <ul className="divide-y divide-watch-100">
            {pendingMyApproval.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  {a.shortName ? <span className="mr-2 font-bold text-bifrost-700">{a.shortName}</span> : null}
                  <span className="font-medium text-watch-900">{a.name}</span>
                </span>
                <Link to={`/cadre/academies/${a.id}`} className="shrink-0 text-bifrost-700 hover:underline">
                  Review &amp; sign off →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">My next assignments</h2>
          {assignmentsLoading ? (
            <div className="flex justify-center py-8"><Spinner className="text-bifrost-400" /></div>
          ) : upcoming.length === 0 ? (
            <EmptyState title="No upcoming assignments" body="Browse open sessions to sign up for a class." />
          ) : (
            <ul className="divide-y divide-watch-50">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <button
                      className="text-left font-medium text-watch-900 hover:underline"
                      onClick={() => setDetailId(a.sessionId)}
                    >
                      {a.courseName}
                    </button>
                    <div className="text-slate-500">
                      {fmtRange(a.start, a.end)} · {a.room}
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-watch-500">{a.role.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/my-schedule" className="mt-3 inline-block text-sm text-bifrost-700 hover:underline">
            Full schedule →
          </Link>
        </section>

        {staff ? (
          <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">
              Needs attention — unfilled slots
            </h2>
            {understaffed.length === 0 ? (
              <EmptyState title="All upcoming sessions are staffed" body="Gjallarhorn rests. For now." />
            ) : (
              <ul className="divide-y divide-watch-50">
                {understaffed.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <button
                        className="text-left font-medium text-watch-900 hover:underline"
                        onClick={() => setDetailId(s.id)}
                      >
                        {s.title || s.courseName}
                      </button>
                      <div className="text-slate-500">
                        {fmtRange(s.start, s.end)} · missing{' '}
                        {unfilledSlots(s)
                          .map((sl) => `${sl.count - sl.filledBy.length} ${sl.role.replace('_', ' ')}`)
                          .join(', ')}
                      </div>
                    </div>
                    <StatusPill status={s.status} />
                  </li>
                ))}
              </ul>
            )}
            <Link to="/cadre/staffing" className="mt-3 inline-block text-sm text-bifrost-700 hover:underline">
              Staffing board →
            </Link>
          </section>
        ) : (
          <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">Get teaching</h2>
            <p className="text-sm text-slate-600">
              Open sessions you are qualified for are listed under{' '}
              <Link to="/open-sessions" className="text-bifrost-700 hover:underline">
                Browse Open Sessions
              </Link>
              . Keep your qualifications current under{' '}
              <Link to="/profile" className="text-bifrost-700 hover:underline">
                Profile
              </Link>
              .
            </p>
          </section>
        )}
      </div>

      {detailId && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
