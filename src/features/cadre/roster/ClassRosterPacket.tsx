/**
 * Whole-class roster packet: ONE attendance sheet per class day, each listing
 * every topic taught that day with its hours, then the full cadet list. Meant
 * for short classes (New Member Training); reached only through the attendance
 * tab's "More options" because it can print a very large stack.
 *
 * Unlike the daily FDLE rosters (one sheet per official course), a day here
 * includes custom blocks too — agency classes build much of their schedule
 * from them — with a toggle to leave them out.
 */
import React, { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { useCollection, type WithId } from '../../../lib/firestore';
import type { AcademyDoc, CurriculumDoc, RosterMemberDoc, SessionDoc, UserDoc } from '../../../types';
import { useGlobalSettings } from '../../../app/providers';
import { Button, Field, Input } from '../../../components/ui';
import { FitToPage } from '../../../components/FitToPage';
import { DocumentHeader } from '../reports/DocumentHeader';
import { buildClassDays, classDateRange, type ClassDay } from './attendanceRoster';
import { RosterTable, SignInTable } from './rosterTables';

/** More sheets than this asks for a second confirmation. */
const BIG_STACK = 40;

const longDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function ClassRosterPacket({
  academy, members, curriculum,
}: {
  academy: WithId<AcademyDoc>;
  members: WithId<RosterMemberDoc>[];
  curriculum: WithId<CurriculumDoc> | null;
}) {
  const settings = useGlobalSettings();
  const { data: sessions, loading: sLoading, error: sError } = useCollection<SessionDoc>('sessions', [where('academyId', '==', academy.id)], [academy.id]);
  const { data: users, loading: uLoading } = useCollection<UserDoc>('users');
  const range = useMemo(() => classDateRange(sessions), [sessions]);
  // Blank until the user types one: the default follows the schedule.
  const [fromPick, setFromPick] = useState('');
  const [toPick, setToPick] = useState('');
  const [includeCustom, setIncludeCustom] = useState(true);
  const [built, setBuilt] = useState(false);
  const from = fromPick || range?.from || '';
  const to = toPick || range?.to || '';

  const official = useMemo(() => new Set((curriculum?.courses ?? []).map((c) => c.name)), [curriculum]);
  const days = useMemo(
    () => (from && to ? buildClassDays(sessions, from, to, includeCustom ? null : official) : []),
    [sessions, from, to, includeCustom, official]
  );
  const names = useMemo(() => new Map(users.map((u) => [u.id, u.displayName])), [users]);
  const cadets = useMemo(() => members.filter((m) => !m.blockTaker), [members]);
  const blockTakers = useMemo(() => members.filter((m) => m.blockTaker), [members]);
  const layout = curriculum?.attendanceLayout ?? 'grid';

  if (sLoading || uLoading) return <p className="text-sm text-slate-500">Loading the class schedule…</p>;
  if (sError) return <p className="text-sm text-red-700">Couldn’t load the class schedule — reload and try again.</p>;
  if (!range) return <p className="text-sm text-slate-500">Nothing is scheduled for this class yet.</p>;

  function build() {
    if (days.length > BIG_STACK && !window.confirm(`This builds ${days.length} pages. Continue?`)) return;
    setBuilt(true);
  }

  return (
    <div>
      <div className="no-print mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
        <div className="font-semibold text-amber-900">Whole-class roster packet</div>
        <p className="mt-1 text-amber-900">
          One page per class day with that day&apos;s topics, hours, and every cadet. Sheets reflect the schedule and roster as they are now,
          so pages printed early go stale if either changes. Use it for short classes; print day by day otherwise.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFromPick(e.target.value)} /></Field>
          <Field label="Through"><Input type="date" value={to} onChange={(e) => setToPick(e.target.value)} /></Field>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={includeCustom} onChange={(e) => setIncludeCustom(e.target.checked)} />
            Include custom blocks (not in the curriculum)
          </label>
          {!built ? (
            <Button variant="secondary" onClick={build} disabled={days.length === 0}>Build {days.length} daily roster{days.length === 1 ? '' : 's'}</Button>
          ) : (
            <Button variant="primary" onClick={() => window.print()} disabled={days.length === 0}>Print {days.length} page{days.length === 1 ? '' : 's'}</Button>
          )}
        </div>
        {days.length === 0 && <p className="mt-2 text-amber-900">No class days in that range.</p>}
      </div>

      {built && (
        // @page sits at the top level — Chrome ignores it inside @media print.
        <>
          <style>{'@page { margin: 0.4in; }'}</style>
          {days.map((d, i) => (
            <DaySheet
              key={d.dateStr} day={d} first={i === 0}
              academy={academy} curriculum={curriculum} settings={settings} layout={layout}
              cadets={cadets} blockTakers={blockTakers} nameOf={(uid) => names.get(uid) ?? ''}
            />
          ))}
        </>
      )}
    </div>
  );
}

function DaySheet({
  day, first, academy, curriculum, settings, layout, cadets, blockTakers, nameOf,
}: {
  day: ClassDay;
  first: boolean;
  academy: WithId<AcademyDoc>;
  curriculum: WithId<CurriculumDoc> | null;
  settings: ReturnType<typeof useGlobalSettings>;
  layout: 'grid' | 'signin';
  cadets: WithId<RosterMemberDoc>[];
  blockTakers: WithId<RosterMemberDoc>[];
  nameOf: (uid: string) => string;
}) {
  const cell = 'border border-black px-1.5 py-0.5';
  return (
    // print:-mx-4 cancels the app shell's own page padding, which otherwise makes
    // Chrome scale every sheet down a second time.
    <div className={`mb-8 overflow-x-auto print:-mx-4 print:mb-0 print:overflow-visible ${first ? '' : 'print:break-before-page'}`}>
      <FitToPage maxHeightIn={9.8}>
        {/* On screen: exactly the printable width, so the fit is measured as it
            will print. In print: the full page width, shrunk sheets included. */}
        <div className="mx-auto w-[7.7in] bg-white text-black print:w-auto print:px-0.5">
          <DocumentHeader
            curriculum={curriculum}
            settings={settings}
            documentTitle="Daily Attendance Roster"
            classLine={[academy.shortName, academy.sequenceNo].filter(Boolean).join(' · ')}
          />
          <div className="mt-2 flex flex-wrap justify-between gap-x-6 text-xs">
            <span className="font-bold">{longDate(day.dateStr)}</span>
            <span>{day.timeLabel}{day.lunch ? ` · Lunch ${day.lunch}` : ''}</span>
            <span><span className="font-bold">{day.totalHours}</span> hours</span>
          </div>
          <table className="mt-1 w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-watch-100/60">
                <th className={`${cell} w-24 text-left`}>Time</th>
                <th className={`${cell} text-left`}>Topic</th>
                <th className={`${cell} w-12`}>Hours</th>
                <th className={`${cell} w-[34%] text-left`}>Instructor(s)</th>
              </tr>
            </thead>
            <tbody>
              {day.topics.map((t, i) => (
                <tr key={i}>
                  <td className={`${cell} tabular-nums`}>{t.timeLabel}</td>
                  <td className={cell}>{t.courseName}</td>
                  <td className={`${cell} text-center tabular-nums`}>{t.classHours}</td>
                  <td className={cell}>
                    {[...t.leadUids.map(nameOf), ...t.writeInLeads, ...t.additionalUids.map(nameOf), ...t.writeInAdditional].filter(Boolean).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {layout === 'signin' ? (
            <SignInTable rows={cadets} />
          ) : (
            <>
              <RosterTable title={null} rows={cadets} renumber />
              {blockTakers.length > 0 && <RosterTable title="Additional Course Takers" rows={blockTakers} renumber />}
            </>
          )}
          {layout === 'signin' && (
            <p className="mt-2 text-[10px] leading-tight">
              By signing this roster, I acknowledge I attended the above listed training and, if applicable, have
              been provided or shown where to access the agency policy on the above listed topics.
            </p>
          )}
          <div className="mt-6 flex items-end justify-between gap-10 text-xs">
            {['Instructor', 'Coordinator'].map((who) => (
              <div key={who} className="flex flex-1 items-end gap-3">
                <div className="flex-1 border-t border-black pt-1">{who}&apos;s Signature</div>
                <div className="w-24 border-t border-black pt-1">Date</div>
              </div>
            ))}
          </div>
        </div>
      </FitToPage>
    </div>
  );
}
