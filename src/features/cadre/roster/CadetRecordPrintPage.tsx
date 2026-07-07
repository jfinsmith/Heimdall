/**
 * Cadet record — a printable org-branded Certificate of Completion (for graduated
 * cadets) followed by a course-by-course Transcript. Org-branded via DocumentHeader
 * (it's a printed document, so it carries the org identity, not Heimdall). Opened
 * in a new tab from the roster; one Print covers both pages.
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { limit, where } from 'firebase/firestore';
import { useDoc, useCollection } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import { useGlobalSettings } from '../../../app/providers';
import type { AcademyDoc, RosterMemberDoc, UserDoc } from '../../../types';
import { fmtDate } from '../../../lib/time';
import { agencyLabel, courseKey, courseResult, effectiveScore, gradedCourses, lastFirst, memberStanding } from './rosterShared';
import { DocumentHeader } from '../reports/DocumentHeader';
import { Button, Spinner } from '../../../components/ui';

const RESULT_LABEL: Record<string, string> = {
  pass: 'Pass', fail: 'Fail', na: 'N/A', xo: 'XO (crossover)', wd: 'Withdrawn', pending: '—',
};

export function CadetRecordPrintPage() {
  const { academyId = '', memberId = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: member, loading: mLoading } = useDoc<RosterMemberDoc>(academyId && memberId ? `academies/${academyId}/roster/${memberId}` : null);
  const { data: curriculum } = useCurriculum(academy?.discipline);
  // Active-only in the QUERY — with limit(2), two suspended command users could
  // otherwise crowd out the active director and misprint the certificate signer.
  const { data: directors } = useCollection<UserDoc>('users', [where('role', 'in', ['director', 'lieutenant']), where('status', '==', 'active'), limit(2)]);
  const directorName = directors[0]?.displayName ?? '';
  const settings = useGlobalSettings();

  if (aLoading || mLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="text-bifrost-400" /></div>;
  if (!academy || !member) return <p className="p-8 text-sm text-slate-500">Record not found.</p>;

  const courses = curriculum?.courses ?? [];
  const graded = gradedCourses(courses);
  const idxById = new Map(graded.map((c, i) => [courseKey(c), i] as const));
  const standing = memberStanding(member, courses);
  const programDates = `${fmtDate(academy.startDate)} – ${fmtDate(academy.endDate)}`;
  const totalHours = curriculum?.totalHours ?? academy.targetTotalHours;
  const isGraduated = member.status === 'graduated';
  const completed = member.completedAt ? fmtDate(member.completedAt) : fmtDate(academy.endDate);
  const classLine = [academy.shortName, academy.sequenceNo].filter(Boolean).join(' · ');

  return (
    <div>
      <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b border-watch-100 bg-white px-4 py-2">
        <button type="button" onClick={() => window.close()} className="text-sm text-bifrost-700 hover:underline">Close tab</button>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>

      {isGraduated && (
        <div className="mx-auto max-w-[8.5in] bg-white p-8 text-center text-black">
          <DocumentHeader curriculum={curriculum} settings={settings} />
          <h1 className="mt-8 text-3xl font-bold uppercase tracking-[0.2em]">Certificate of Completion</h1>
          <p className="mt-8 text-sm">This certifies that</p>
          <p className="mt-2 text-2xl font-semibold">{member.fullName}</p>
          <p className="mt-6 text-sm leading-relaxed">
            has successfully completed the<br />
            <strong>{curriculum?.fdleProgram || academy.name}</strong> ({totalHours} hours)<br />
            conducted by {settings?.orgName || 'the academy'}, {programDates},<br />
            in accordance with the Florida Criminal Justice Standards and Training Commission (CJSTC).
          </p>
          <p className="mt-6 text-sm">Awarded {completed}{academy.location ? ` at ${academy.location}` : ''}.</p>
          <div className="mt-16 flex items-start justify-center gap-12 text-xs">
            <div className="w-64">
              <div className="h-10 border-b border-black" />
              <div className="pt-1">{directorName}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Academy Director</div>
            </div>
            <div className="w-40">
              <div className="h-10 border-b border-black" />
              <div className="pt-1 text-[10px] uppercase tracking-wide text-slate-500">Date</div>
            </div>
          </div>
          {classLine && <p className="mt-8 text-[10px] text-slate-500">Class {classLine}</p>}
        </div>
      )}

      <div className={`mx-auto max-w-[8.5in] bg-white p-6 text-black ${isGraduated ? 'print:break-before-page' : ''}`}>
        <DocumentHeader curriculum={curriculum} settings={settings} documentTitle="Cadet Transcript" classLine={classLine} />

        <table className="mt-3 w-full border-collapse text-xs">
          <tbody>
            <tr>
              <td className="border border-black px-1.5 py-1"><div className="text-[8px] font-bold uppercase text-black/70">Name</div>{lastFirst(member.fullName)}</td>
              <td className="border border-black px-1.5 py-1"><div className="text-[8px] font-bold uppercase text-black/70">Student ID</div>{member.studentId || '—'}</td>
              <td className="border border-black px-1.5 py-1"><div className="text-[8px] font-bold uppercase text-black/70">DOB</div>{member.dob ? new Date(`${member.dob}T12:00:00`).toLocaleDateString() : '—'}</td>
              <td className="border border-black px-1.5 py-1"><div className="text-[8px] font-bold uppercase text-black/70">Agency</div>{agencyLabel(member)}</td>
              <td className="border border-black px-1.5 py-1"><div className="text-[8px] font-bold uppercase text-black/70">Outcome</div>{member.status === 'graduated' ? 'Graduated' : member.status === 'dismissed' ? 'Dismissed' : member.status === 'withdrawn' ? 'Withdrawn' : 'In progress'}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-watch-100/60">
              <th className="w-20 border border-black px-1 py-1">CJK</th>
              <th className="border border-black px-1 py-1 text-left">Course</th>
              <th className="w-16 border border-black px-1 py-1">Hours</th>
              <th className="w-16 border border-black px-1 py-1">Score</th>
              <th className="w-24 border border-black px-1 py-1">Result</th>
            </tr>
          </thead>
          <tbody>
            {graded.map((c, i) => {
              const eff = effectiveScore(member.grades?.[courseKey(c)]);
              const res = courseResult(member, c, idxById, i);
              return (
                <tr key={courseKey(c)}>
                  <td className="border border-black px-1 py-1 text-center font-mono text-[10px]">{c.cjk ?? ''}</td>
                  <td className="border border-black px-1 py-1">{c.highLiability ? '▲ ' : ''}{c.name}</td>
                  <td className="border border-black px-1 py-1 text-center tabular-nums">{c.minHours}</td>
                  <td className="border border-black px-1 py-1 text-center tabular-nums">{eff != null ? eff : '—'}</td>
                  <td className="border border-black px-1 py-1 text-center">{RESULT_LABEL[res] ?? res}</td>
                </tr>
              );
            })}
            {graded.length === 0 && <tr><td colSpan={5} className="border border-black px-1 py-3 text-center text-slate-500">No tested courses in this curriculum.</td></tr>}
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-xs">
          <span><strong>Class average:</strong> {standing.avgPct != null ? `${standing.avgPct.toFixed(1)}% (${standing.letter})` : '—'}</span>
          <span><strong>Program hours:</strong> {totalHours}</span>
          <span><strong>Program dates:</strong> {programDates}</span>
        </div>
        {standing.warnings.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-[10px] text-slate-600">
            {standing.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <div className="mt-10 flex items-start gap-8 text-xs">
          <div className="flex-1">
            <div className="h-10 border-b border-black" />
            <div className="pt-1">{directorName || 'Academy Director'}</div>
            <div className="text-[10px] uppercase text-slate-500">Academy Director</div>
          </div>
          <div className="w-40">
            <div className="h-10 border-b border-black" />
            <div className="pt-1 text-[10px] uppercase text-slate-500">Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}
