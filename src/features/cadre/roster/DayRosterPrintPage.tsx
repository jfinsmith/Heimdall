/**
 * Daily training sign-in roster (the NMT-style sheet) — a clean printable page
 * for ONE day: the day's course load (every session/topic scheduled that date)
 * listed at the top, then a NO. / CJIS & NAME / SIGNATURE grid the students sign
 * once to acknowledge the day's training. Opened in a new tab from the builder.
 *
 * Org-branded (per the branding split: printed documents carry the org, the app
 * UI stays Heimdall). Reuses the attendance-print look + the fluid positional
 * numbering.
 */
import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { useCollection, useDoc } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import { useGlobalSettings } from '../../../app/providers';
import type { AcademyDoc, RosterMemberDoc, SessionDoc, UserDoc } from '../../../types';
import { DocumentHeader } from '../reports/DocumentHeader';
import { Button, Spinner } from '../../../components/ui';

/** A session is "on" the given yyyy-mm-dd if its local start date matches. */
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(d: Date) {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function DayRosterPrintPage() {
  const { academyId = '', date = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: rosterRaw, loading: rLoading } = useCollection<RosterMemberDoc>(
    academyId ? `academies/${academyId}/roster` : null, [], [academyId]
  );
  const { data: sessionsRaw } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null, academyId ? [where('academyId', '==', academyId)] : [], [academyId]
  );
  const coordId = academy?.coordinatorIds?.[0];
  const { data: coordinator } = useDoc<UserDoc>(coordId ? `users/${coordId}` : null);
  const { data: curriculum } = useCurriculum(academy?.discipline);
  const { data: users } = useCollection<UserDoc>('users');
  const settings = useGlobalSettings();

  const nameFor = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u.displayName]));
    return (uid: string) => map.get(uid) ?? '—';
  }, [users]);
  // Instructors assigned to a session = the filled lead/assistant/safety slots
  // (coordinators/role-players excluded), lead first.
  const instructorsFor = (s: SessionDoc) =>
    s.roleSlots
      .filter((sl) => sl.role === 'lead' || sl.role === 'assistant' || sl.role === 'safety_officer')
      .flatMap((sl) => sl.filledBy)
      .map(nameFor);

  if (aLoading || rLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="text-bifrost-400" /></div>;
  if (!academy) return <p className="p-8 text-sm text-slate-500">Academy not found.</p>;

  // The day's course load: real instructional blocks scheduled that date.
  const topics = [...sessionsRaw]
    .filter((s) => s.kind !== 'lunch' && s.status !== 'cancelled' && localDateStr(s.start.toDate()) === date)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());

  // Active cadets (no withdrawn, no block-takers), positionally numbered.
  const cadets = [...rosterRaw]
    .filter((m) => m.status !== 'withdrawn' && !m.blockTaker)
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0));

  const prettyDate = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const classLine = [academy.shortName, academy.sequenceNo].filter(Boolean).join(' · ');
  const coordName = coordinator ? `${coordinator.rank ? `${coordinator.rank} ` : ''}${coordinator.displayName}` : '';

  return (
    <div>
      <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b border-watch-100 bg-white px-4 py-2">
        <Link to={`/cadre/academies/${academyId}`} className="text-sm text-bifrost-700 hover:underline">← Back to builder</Link>
        <span className="text-sm text-slate-500">{prettyDate}</span>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="mx-auto max-w-[8.5in] bg-white p-6 text-black">
        <DocumentHeader curriculum={curriculum} settings={settings} documentTitle="Training Roster" classLine={classLine} />

        <div className="mt-3 flex items-end justify-between text-xs">
          <div><span className="font-bold uppercase text-black/70">Date: </span>{prettyDate}</div>
          {coordName && <div><span className="font-bold uppercase text-black/70">Coordinator: </span>{coordName}</div>}
        </div>

        {/* The day's course load (the "above listed training") */}
        <div className="mt-3 bg-black px-1 py-0.5 text-[10px] font-bold uppercase text-white">Topics covered</div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-watch-100/60">
              <th className="w-[24%] border border-black px-2 py-0.5 text-left">Time</th>
              <th className="border border-black px-2 py-0.5 text-left">Topic</th>
              <th className="w-[32%] border border-black px-2 py-0.5 text-left">Instructor(s)</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => {
              const instructors = instructorsFor(t);
              return (
                <tr key={t.id}>
                  <td className="w-[24%] border border-black px-2 py-1 align-top tabular-nums">{fmtTime(t.start.toDate())} – {fmtTime(t.end.toDate())}</td>
                  <td className="border border-black px-2 py-1">{t.title || t.courseName}{t.highLiability ? ' ▲' : ''}</td>
                  <td className="w-[32%] border border-black px-2 py-1 align-top">{instructors.length ? instructors.join(', ') : <span className="text-slate-400">—</span>}</td>
                </tr>
              );
            })}
            {topics.length === 0 && (
              <tr><td colSpan={3} className="border border-black px-2 py-3 text-center text-slate-500">No sessions scheduled on this date.</td></tr>
            )}
          </tbody>
        </table>

        <p className="mt-3 text-[10px] leading-tight">
          By signing this roster, I acknowledge I attended the above listed training and, if applicable, have been
          provided or shown where to access the agency policy on the above listed topic.
        </p>

        {/* Sign-in grid */}
        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-watch-100/60">
              <th className="w-8 border border-black px-1 py-0.5">No.</th>
              <th className="w-[44%] border border-black px-1 py-0.5 text-left">CJIS &amp; Name</th>
              <th className="border border-black px-1 py-0.5 text-left">Signature</th>
            </tr>
          </thead>
          <tbody>
            {cadets.map((m, i) => (
              <tr key={m.id}>
                <td className="border border-black px-1 py-2 text-center tabular-nums">{i + 1}</td>
                <td className="border border-black px-1 py-2">
                  {m.cjis ? <span className="mr-2 font-semibold tabular-nums">{m.cjis}</span> : null}{m.fullName}
                </td>
                <td className="border border-black" />
              </tr>
            ))}
            {cadets.length === 0 && (
              <tr><td colSpan={3} className="border border-black px-1 py-3 text-center text-slate-500">No active cadets on the roster.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
