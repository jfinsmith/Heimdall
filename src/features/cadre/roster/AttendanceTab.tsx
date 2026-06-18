/**
 * Printable Attendance Roster — mirrors the agency's official sheet: header
 * block (course title, program dates, class hours, seq #, class #, total hours,
 * lunch), the signed roster with time in/out and staff-action boxes, an
 * "Additional Block Takers" section, and the instructor signature footer.
 * The config row (no-print) drives the fields; everything else prints clean.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { AcademyDoc, CurriculumDoc, RosterMemberDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { fmtDate } from '../../../lib/time';
import { Button, Field, Input, Select, TextArea } from '../../../components/ui';

const todayStr = () => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

function Lbl({ children }: { children: React.ReactNode }) {
  return <div className="text-[8px] font-bold uppercase tracking-wide text-black/70">{children}</div>;
}

/** A bordered metadata cell. `wide` spans the remaining 3 columns (lunch row). */
function Cell({ children, w, wide }: { children?: React.ReactNode; w?: string; wide?: boolean }) {
  return (
    <td colSpan={wide ? 3 : 1} className={`border border-black px-1.5 py-1 align-top ${w ?? ''}`}>
      {children}
    </td>
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
  const courses = curriculum?.courses ?? [];
  const [courseName, setCourseName] = useState(courses[0]?.name ?? '');
  const course = courses.find((c) => c.name === courseName);
  const [classDate, setClassDate] = useState(todayStr());
  const [classHours, setClassHours] = useState('');
  const [lead, setLead] = useState('');
  const [additional, setAdditional] = useState('');
  const [seqNo, setSeqNo] = useState('');
  const [lunch, setLunch] = useState('1200 - 1300');
  const [totalHours, setTotalHours] = useState(String(curriculum?.totalHours ?? academy.targetTotalHours));
  // Ad-hoc people taking this course who are NOT on the roster (one name per line).
  const [additionalTakers, setAdditionalTakers] = useState('');

  // Reset per-course defaults when the course changes.
  useEffect(() => {
    setSeqNo(course?.courseSeqNo ?? '');
    setClassHours(course?.minHours ? String(course.minHours) : '');
  }, [courseName]); // eslint-disable-line react-hooks/exhaustive-deps

  const programDates = `${fmtDate(academy.startDate)} - ${fmtDate(academy.endDate)}`;
  const cadets = useMemo(() => members.filter((m) => !m.blockTaker).sort((a, b) => a.no - b.no), [members]);
  const blockTakers = useMemo(() => members.filter((m) => m.blockTaker).sort((a, b) => a.no - b.no), [members]);
  // "Additional course takers" = roster-flagged block takers PLUS ad-hoc typed
  // names (not on the roster). They print in a clearly separated bottom section.
  const extraTakers = useMemo(
    () => additionalTakers.split('\n').map((s) => s.trim()).filter(Boolean).map((name, i) => ({ id: `extra-${i}`, no: 0, fullName: name, status: '' })),
    [additionalTakers]
  );
  const additionalSection = useMemo(() => [...blockTakers, ...extraTakers], [blockTakers, extraTakers]);

  return (
    <div>
      {/* Config — not printed */}
      <div className="no-print mb-4 grid gap-3 rounded-lg border border-watch-100 bg-watch-50 p-4 sm:grid-cols-3">
        <Field label="Course / topic">
          <Select value={courseName} onChange={(e) => setCourseName(e.target.value)}>
            {courses.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Class date (today's class)"><Input value={classDate} onChange={(e) => setClassDate(e.target.value)} /></Field>
        <Field label="Class hours (taught today)"><Input value={classHours} onChange={(e) => setClassHours(e.target.value)} placeholder="e.g. 8" /></Field>
        <Field label="Lead instructor(s)"><Input value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
        <Field label="Additional instructors"><Input value={additional} onChange={(e) => setAdditional(e.target.value)} /></Field>
        <Field label="Course Seq. #"><Input value={seqNo} onChange={(e) => setSeqNo(e.target.value)} placeholder="65-2026-2010-2" /></Field>
        <Field label="Total hours"><Input value={totalHours} onChange={(e) => setTotalHours(e.target.value)} /></Field>
        <Field label="Lunch (From - To)"><Input value={lunch} onChange={(e) => setLunch(e.target.value)} /></Field>
        <Field label="Additional course takers (one name per line)" className="sm:col-span-2" hint="People taking this course who are NOT on the roster — printed in a separate section at the bottom.">
          <TextArea value={additionalTakers} onChange={(e) => setAdditionalTakers(e.target.value)} rows={3} placeholder={'Jane Smith\nJohn Doe'} />
        </Field>
        <div className="flex items-end">
          <Button variant="primary" onClick={() => window.print()}>Print attendance roster</Button>
        </div>
      </div>

      {/* Printable sheet */}
      <div className="mx-auto max-w-[8.5in] bg-white p-4 text-black">
        <div className="text-center">
          <div className="text-lg font-bold uppercase">Pasco-Hernando State College</div>
          <div className="text-sm font-semibold">{academy.fdleProgram?.replace(/^FDLE\s*/, '') || academy.discipline}</div>
          <div className="text-sm font-semibold uppercase tracking-wide">Attendance Roster</div>
        </div>

        <table className="mt-3 w-full border-collapse text-xs">
          <tbody>
            <tr>
              <Cell w="w-[34%]"><Lbl>Course Title</Lbl>{course?.name}</Cell>
              <Cell w="w-[28%]"><Lbl>Program Dates</Lbl>{programDates}</Cell>
              <Cell w="w-[18%]"><Lbl>Class Hours</Lbl>{classHours}</Cell>
              <Cell w="w-[20%]"><Lbl>Today's Date</Lbl>{classDate}</Cell>
            </tr>
            <tr>
              <Cell><Lbl>Lead Instructor(s)</Lbl>{lead}</Cell>
              <Cell><Lbl>Course Seq. #</Lbl>{seqNo}</Cell>
              <Cell><Lbl>Class #</Lbl>{academy.shortName}</Cell>
              <Cell><Lbl>Total Hours</Lbl>{totalHours}</Cell>
            </tr>
            <tr>
              <Cell wide><Lbl>Additional</Lbl>{additional}</Cell>
              <Cell><Lbl>Lunch (From - To)</Lbl>{lunch}</Cell>
            </tr>
          </tbody>
        </table>

        <p className="mt-2 text-[8px] leading-tight">
          Cadets who do not sign in at the required course time must fill out an Excused Absence Form by the next
          class session, submitted to the Director via the Coordinator. Failure to sign in/out could result in a
          course failure and disciplinary action up to and including dismissal from the academy. ****This is an
          official document. Any attempt to falsify the information on this roster will result in disciplinary
          action, up to and including, Dismissal from the Academy and/or termination of employment.****
        </p>

        <RosterTable title={null} rows={cadets} />
        {additionalSection.length > 0 && <RosterTable title="Additional Course Takers" rows={additionalSection} renumber />}

        <div className="mt-8 flex items-end gap-8 text-xs">
          <div className="flex-1 border-t border-black pt-1">Instructor's Signature</div>
          <div className="w-40 border-t border-black pt-1">Date</div>
        </div>
      </div>
    </div>
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
