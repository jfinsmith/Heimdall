/**
 * The day's documents for ONE date — opened in a new tab from the builder's
 * Print / "Print next day's documents" buttons. Runs the SAME logic as the
 * roster's Attendance tab → "From schedule" (ScheduleDayDocuments): one
 * attendance roster per contiguous course run, plus the exam forms when a
 * block that day is a test. (This replaced the old single-sheet day sign-in
 * roster, whose logic had drifted from the roster tab's.)
 *
 * Org-branded (per the branding split: printed documents carry the org, the
 * app UI stays Heimdall).
 */
import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCollection, useDoc } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import type { AcademyDoc, RosterMemberDoc } from '../../../types';
import { rosterCompare } from './rosterShared';
import { ScheduleDayDocuments } from './AttendanceTab';
import { Button, Spinner } from '../../../components/ui';

export function DayRosterPrintPage() {
  const { academyId = '', date = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: rosterRaw, loading: rLoading } = useCollection<RosterMemberDoc>(
    academyId ? `academies/${academyId}/roster` : null, [], [academyId]
  );
  const { data: curriculum } = useCurriculum(academy?.discipline);
  // Canonical roster order (alphabetical by last name, withdrawn/dismissed
  // last) — exactly what the roster page hands its Attendance tab.
  const members = useMemo(() => [...rosterRaw].sort(rosterCompare), [rosterRaw]);

  if (aLoading || rLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="text-bifrost-400" /></div>;
  if (!academy) return <p className="p-8 text-sm text-slate-500">Academy not found.</p>;

  const prettyDate = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

  return (
    <div>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-watch-100 bg-white px-4 py-2">
        <Link to={`/cadre/academies/${academyId}`} className="text-sm text-bifrost-700 hover:underline">← Back to builder</Link>
        <span className="text-sm text-slate-600">
          <span className="font-semibold">{academy.shortName || academy.name}</span> — documents for {prettyDate}
        </span>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>
      <div className="p-4 print:p-0">
        <ScheduleDayDocuments academy={{ ...academy, id: academyId }} members={members} curriculum={curriculum ?? null} dateStr={date} />
      </div>
    </div>
  );
}
