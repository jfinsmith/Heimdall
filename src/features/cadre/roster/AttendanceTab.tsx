/**
 * Printable Attendance Roster — mirrors the agency's official sheet: header block
 * (course title, program dates, class time/hours, seq #, class #, total hours,
 * lunch), the signed roster with time in/out and staff-action boxes, an
 * "Additional Block Takers" section, and the instructor signature footer.
 *
 * Two modes:
 *  • Manual — pick a course and type the day's details (legacy behavior).
 *  • From schedule — pick a date; the day's calendar blocks are grouped into ONE
 *    roster per course (a course's morning + afternoon merge into a single sheet
 *    spanning the lunch), pre-filled with the whole-day time span, summed class
 *    hours, the lunch window, and the instructors signed up for those blocks.
 *    Every field stays editable before printing (walk-in instructors are written
 *    in by hand). All generated sheets print together with page breaks.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { where } from 'firebase/firestore';
import { useCollection, type WithId } from '../../../lib/firestore';
import type { AcademyDoc, CurriculumCourse, CurriculumDoc, RosterMemberDoc, SessionDoc, UserDoc } from '../../../types';
import { fmtDate } from '../../../lib/time';
import { useGlobalSettings } from '../../../app/providers';
import { DocumentHeader } from '../reports/DocumentHeader';
import { buildDayRosters, localDateStr } from './attendanceRoster';
import { Button, Field, Input, Select, TextArea } from '../../../components/ui';
import type { GlobalSettings } from '../../../types';

/** yyyy-mm-dd → M/D/YYYY (local, no timezone shift). */
function displayDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div className="text-[8px] font-bold uppercase tracking-wide text-black/70">{children}</div>;
}

/** A bordered metadata cell. `span` sets the column span (default 1). */
function Cell({ children, w, span = 1 }: { children?: React.ReactNode; w?: string; span?: number }) {
  return (
    <td colSpan={span} className={`border border-black px-1.5 py-1 align-top ${w ?? ''}`}>
      {children}
    </td>
  );
}

interface SheetFields {
  courseTitle: string;
  programDates: string;
  classTime: string;
  classHours: string;
  classDate: string;
  lead: string;
  seqNo: string;
  classNo: string;
  totalHours: string;
  additional: string;
  lunch: string;
}

type Extra = { id: string; no: number; fullName: string; status: string };

/** Pure printable sheet — the FDLE roster. `pageBreak` forces a new page when
 *  several generated sheets stack on one print job. */
function PrintSheet({
  academy,
  curriculum,
  settings,
  layout,
  fields,
  cadets,
  additionalSection,
  pageBreak,
}: {
  academy: WithId<AcademyDoc>;
  curriculum: WithId<CurriculumDoc> | null;
  settings: GlobalSettings | null;
  layout: 'grid' | 'signin';
  fields: SheetFields;
  cadets: WithId<RosterMemberDoc>[];
  additionalSection: (WithId<RosterMemberDoc> | Extra)[];
  pageBreak?: boolean;
}) {
  return (
    <div className={`mx-auto max-w-[8.5in] bg-white p-4 text-black ${pageBreak ? 'print:break-before-page' : ''}`}>
      <DocumentHeader
        curriculum={curriculum}
        settings={settings}
        documentTitle="Attendance Roster"
        classLine={[academy.shortName, academy.sequenceNo].filter(Boolean).join(' · ')}
      />

      <table className="mt-3 w-full border-collapse text-xs">
        <tbody>
          <tr>
            <Cell w="w-[34%]"><Lbl>Course Title</Lbl>{fields.courseTitle}</Cell>
            <Cell w="w-[28%]"><Lbl>Program Dates</Lbl>{fields.programDates}</Cell>
            <Cell w="w-[18%]"><Lbl>Class Hours</Lbl>{fields.classHours}</Cell>
            <Cell w="w-[20%]"><Lbl>Today's Date</Lbl>{fields.classDate}</Cell>
          </tr>
          <tr>
            <Cell><Lbl>Lead Instructor(s)</Lbl>{fields.lead}</Cell>
            <Cell><Lbl>Course Seq. #</Lbl>{fields.seqNo}</Cell>
            <Cell><Lbl>Class #</Lbl>{fields.classNo}</Cell>
            <Cell><Lbl>Total Hours</Lbl>{fields.totalHours}</Cell>
          </tr>
          <tr>
            <Cell span={2}><Lbl>Additional</Lbl>{fields.additional}</Cell>
            <Cell><Lbl>Class Time</Lbl>{fields.classTime}</Cell>
            <Cell><Lbl>Lunch (From - To)</Lbl>{fields.lunch}</Cell>
          </tr>
        </tbody>
      </table>

      {layout === 'signin' ? (
        <>
          <SignInTable rows={cadets} />
          <p className="mt-3 text-[10px] leading-tight">
            By signing this roster, I acknowledge I attended the above listed training and, if applicable, have
            been provided or shown where to access the agency policy on the above listed topic.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[8px] leading-tight">
            Cadets who do not sign in at the required course time must fill out an Excused Absence Form by the next
            class session, submitted to the Director via the Coordinator. Failure to sign in/out could result in a
            course failure and disciplinary action up to and including dismissal from the academy. ****This is an
            official document. Any attempt to falsify the information on this roster will result in disciplinary
            action, up to and including, Dismissal from the Academy and/or termination of employment.****
          </p>
          <RosterTable title={null} rows={cadets} renumber />
          {additionalSection.length > 0 && <RosterTable title="Additional Course Takers" rows={additionalSection} renumber />}
        </>
      )}

      <div className="mt-8 flex items-end gap-8 text-xs">
        <div className="flex-1 border-t border-black pt-1">{layout === 'signin' ? 'Coordinator / Instructor Signature' : "Instructor's Signature"}</div>
        <div className="w-40 border-t border-black pt-1">Date</div>
      </div>
    </div>
  );
}

interface SheetInit {
  courseName: string;
  classDate: string;
  classTime: string;
  classHours: string;
  lead: string;
  additional: string;
  seqNo: string;
  lunch: string;
  totalHours: string;
}

/** One editable roster: a no-print config row over the printable sheet. State is
 *  seeded from `init` once; changing the course resets seq #/hours like the legacy
 *  sheet, but the first render keeps the seeded (pulled-from-schedule) values. */
function SheetEditor({
  init,
  academy,
  curriculum,
  settings,
  layout,
  courses,
  cadets,
  blockTakers,
  pageBreak,
}: {
  init: SheetInit;
  academy: WithId<AcademyDoc>;
  curriculum: WithId<CurriculumDoc> | null;
  settings: GlobalSettings | null;
  layout: 'grid' | 'signin';
  courses: CurriculumCourse[];
  cadets: WithId<RosterMemberDoc>[];
  blockTakers: WithId<RosterMemberDoc>[];
  pageBreak?: boolean;
}) {
  const [courseName, setCourseName] = useState(init.courseName);
  const [classDate, setClassDate] = useState(init.classDate);
  const [classTime, setClassTime] = useState(init.classTime);
  const [classHours, setClassHours] = useState(init.classHours);
  const [lead, setLead] = useState(init.lead);
  const [additional, setAdditional] = useState(init.additional);
  const [seqNo, setSeqNo] = useState(init.seqNo);
  const [lunch, setLunch] = useState(init.lunch);
  const [totalHours, setTotalHours] = useState(init.totalHours);
  const [additionalTakers, setAdditionalTakers] = useState('');

  // Reset seq #/hours to the course defaults on a USER course change (skip the
  // initial mount so seeded schedule values aren't clobbered).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const c = courses.find((x) => x.name === courseName);
    setSeqNo(academy.sequenceNo || c?.courseSeqNo || '');
    setClassHours(c?.minHours != null ? String(c.minHours) : '');
  }, [courseName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always offer the current course even if it isn't in the curriculum (a custom
  // block pulled from the schedule).
  const courseOptions = useMemo(() => {
    const names = courses.map((c) => c.name);
    return courseName && !names.includes(courseName) ? [courseName, ...names] : names;
  }, [courses, courseName]);

  const programDates = `${fmtDate(academy.startDate)} - ${fmtDate(academy.endDate)}`;
  const extraTakers = useMemo<Extra[]>(
    () => additionalTakers.split('\n').map((s) => s.trim()).filter(Boolean).map((name, i) => ({ id: `extra-${i}`, no: 0, fullName: name, status: '' })),
    [additionalTakers]
  );
  const additionalSection = useMemo(() => [...blockTakers, ...extraTakers], [blockTakers, extraTakers]);

  const fields: SheetFields = {
    courseTitle: courseName,
    programDates,
    classTime,
    classHours,
    classDate,
    lead,
    seqNo,
    classNo: academy.shortName ?? '',
    totalHours,
    additional,
    lunch,
  };

  return (
    <div className="mb-8">
      <div className="no-print mb-3 grid gap-3 rounded-lg border border-watch-100 bg-watch-50 p-4 sm:grid-cols-3">
        <Field label="Course / topic">
          <Select value={courseName} onChange={(e) => setCourseName(e.target.value)}>
            {courseOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="Class date"><Input value={classDate} onChange={(e) => setClassDate(e.target.value)} /></Field>
        <Field label="Class time (From - To)"><Input value={classTime} onChange={(e) => setClassTime(e.target.value)} placeholder="0800 - 1700" /></Field>
        <Field label="Class hours (taught today)"><Input value={classHours} onChange={(e) => setClassHours(e.target.value)} placeholder="e.g. 8" /></Field>
        <Field label="Lead instructor(s)"><Input value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
        <Field label="Additional instructors"><Input value={additional} onChange={(e) => setAdditional(e.target.value)} /></Field>
        <Field label="Course Seq. #"><Input value={seqNo} onChange={(e) => setSeqNo(e.target.value)} placeholder="65-2026-2010-2" /></Field>
        <Field label="Total hours"><Input value={totalHours} onChange={(e) => setTotalHours(e.target.value)} /></Field>
        <Field label="Lunch (From - To)"><Input value={lunch} onChange={(e) => setLunch(e.target.value)} /></Field>
        <Field label="Additional course takers (one name per line)" className="sm:col-span-3" hint="People taking this course who are NOT on the roster — printed in a separate section at the bottom.">
          <TextArea value={additionalTakers} onChange={(e) => setAdditionalTakers(e.target.value)} rows={2} placeholder={'Jane Smith\nJohn Doe'} />
        </Field>
      </div>

      <PrintSheet
        academy={academy}
        curriculum={curriculum}
        settings={settings}
        layout={layout}
        fields={fields}
        cadets={cadets}
        additionalSection={additionalSection}
        pageBreak={pageBreak}
      />
    </div>
  );
}

export function AttendanceTab({
  academy,
  members,
  curriculum,
}: {
  academy: WithId<AcademyDoc>;
  members: WithId<RosterMemberDoc>[];
  curriculum: WithId<CurriculumDoc> | null;
}) {
  const settings = useGlobalSettings();
  const layout = curriculum?.attendanceLayout ?? 'grid';
  const courses = curriculum?.courses ?? [];
  const cadets = useMemo(() => members.filter((m) => !m.blockTaker).sort((a, b) => a.no - b.no), [members]);
  const blockTakers = useMemo(() => members.filter((m) => m.blockTaker).sort((a, b) => a.no - b.no), [members]);

  const [mode, setMode] = useState<'manual' | 'schedule'>('manual');
  const [genDate, setGenDate] = useState(localDateStr(new Date()));
  const [includeNonFdle, setIncludeNonFdle] = useState(true);

  // Schedule mode pulls the day's blocks + instructor names from the calendar.
  const { data: sessions, loading: sLoading } = useCollection<SessionDoc>(
    mode === 'schedule' ? 'sessions' : null,
    [where('academyId', '==', academy.id)],
    [academy.id]
  );
  const { data: users, loading: uLoading } = useCollection<UserDoc>(mode === 'schedule' ? 'users' : null);
  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.displayName ?? '';

  const totalHoursStr = String(curriculum?.totalHours ?? academy.targetTotalHours);
  const generated = useMemo(
    () => (mode === 'schedule' ? buildDayRosters(sessions, genDate, { includeNonFdle }) : []),
    [mode, sessions, genDate, includeNonFdle]
  );

  const manualInit: SheetInit = {
    courseName: courses[0]?.name ?? '',
    classDate: displayDate(localDateStr(new Date())),
    classTime: '',
    classHours: courses[0]?.minHours != null ? String(courses[0].minHours) : '',
    lead: '',
    additional: '',
    seqNo: academy.sequenceNo || courses[0]?.courseSeqNo || '',
    lunch: '1200 - 1300',
    totalHours: totalHoursStr,
  };

  const scheduleLoading = sLoading || uLoading;
  const tab = 'rounded px-3 py-1';

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-md border border-watch-200 p-0.5 text-sm">
          <button type="button" className={mode === 'manual' ? `${tab} bg-watch-800 text-white` : `${tab} text-watch-700`} onClick={() => setMode('manual')}>Manual</button>
          <button type="button" className={mode === 'schedule' ? `${tab} bg-watch-800 text-white` : `${tab} text-watch-700`} onClick={() => setMode('schedule')}>From schedule</button>
        </div>
        {mode === 'schedule' && (
          <>
            <Field label="Date" className="max-w-[11rem]"><Input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} /></Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-watch-700">
              <input type="checkbox" checked={includeNonFdle} onChange={(e) => setIncludeNonFdle(e.target.checked)} />
              Include non-FDLE blocks (PSO / formation)
            </label>
          </>
        )}
        <Button variant="primary" onClick={() => window.print()}>
          Print attendance roster{mode === 'schedule' && generated.length > 1 ? 's' : ''}
        </Button>
      </div>

      {mode === 'manual' ? (
        <SheetEditor
          key={`manual-${curriculum?.id ?? 'none'}`}
          init={manualInit}
          academy={academy}
          curriculum={curriculum}
          settings={settings}
          layout={layout}
          courses={courses}
          cadets={cadets}
          blockTakers={blockTakers}
        />
      ) : scheduleLoading ? (
        <p className="text-sm text-slate-500">Loading the day's schedule…</p>
      ) : generated.length === 0 ? (
        <p className="text-sm text-slate-500">No instructional blocks scheduled on {displayDate(genDate)}. Pick another date.</p>
      ) : (
        generated.map((g, i) => (
          <SheetEditor
            key={`${genDate}-${i}-${g.courseName}`}
            init={{
              courseName: g.courseName,
              classDate: displayDate(genDate),
              classTime: g.timeLabel,
              classHours: String(g.classHours),
              lead: g.leadUids.map(nameOf).filter(Boolean).join(', '),
              additional: g.additionalUids.map(nameOf).filter(Boolean).join(', '),
              seqNo: academy.sequenceNo || '',
              lunch: g.lunch,
              totalHours: totalHoursStr,
            }}
            academy={academy}
            curriculum={curriculum}
            settings={settings}
            layout={layout}
            courses={courses}
            cadets={cadets}
            blockTakers={blockTakers}
            pageBreak={i > 0}
          />
        ))
      )}
    </div>
  );
}

/** Sign-in sheet layout (NMT/ARGUS): NO. / CJIS & Name / Signature, active cadets
 *  only, positionally numbered. */
function SignInTable({ rows }: { rows: WithId<RosterMemberDoc>[] }) {
  const active = rows.filter((m) => m.status !== 'withdrawn');
  return (
    <table className="mt-3 w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-watch-100/60">
          <th className="w-8 border border-black px-1 py-0.5">No.</th>
          <th className="w-[44%] border border-black px-1 py-0.5 text-left">CJIS &amp; Name</th>
          <th className="border border-black px-1 py-0.5 text-left">Signature</th>
        </tr>
      </thead>
      <tbody>
        {active.map((m, i) => (
          <tr key={m.id}>
            <td className="border border-black px-1 py-2 text-center tabular-nums">{i + 1}</td>
            <td className="border border-black px-1 py-2">
              {m.cjis ? <span className="mr-2 font-semibold tabular-nums">{m.cjis}</span> : null}{m.fullName}
            </td>
            <td className="border border-black" />
          </tr>
        ))}
        {active.length === 0 && (
          <tr><td colSpan={3} className="border border-black px-1 py-3 text-center text-slate-500">No active cadets.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function RosterTable({
  title,
  rows,
  renumber,
}: {
  title: string | null;
  rows: { id: string; no: number; fullName: string; status: string }[];
  renumber?: boolean;
}) {
  return (
    <>
      {title && <div className="mt-3 bg-black px-1 py-0.5 text-[10px] font-bold uppercase text-white">{title}</div>}
      <table className="mt-1 w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-watch-100/60">
            <th className="w-6 border border-black px-1 py-0.5">No.</th>
            <th className="border border-black px-1 py-0.5 text-left">Name</th>
            <th className="w-[26%] border border-black px-1 py-0.5">Signature</th>
            <th className="w-12 border border-black px-1 py-0.5">In</th>
            <th className="w-12 border border-black px-1 py-0.5">Out</th>
            <th className="w-8 border border-black px-1 py-0.5" title="Approved">APP</th>
            <th className="w-8 border border-black px-1 py-0.5" title="Disciplinary action">D/A</th>
            <th className="w-12 border border-black px-1 py-0.5">Makeup</th>
            <th className="w-12 border border-black px-1 py-0.5">Sgt</th>
            <th className="w-12 border border-black px-1 py-0.5">Dir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.id}>
              <td className="border border-black px-1 py-1 text-center tabular-nums">{renumber ? i + 1 : m.no}</td>
              <td className="border border-black px-1 py-1">{m.fullName}</td>
              <td className="border border-black px-1 py-1 text-center text-[9px] font-bold uppercase text-slate-500">
                {m.status === 'withdrawn' ? 'Withdrawn' : ''}
              </td>
              <td className="h-7 border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
