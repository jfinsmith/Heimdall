/**
 * Exam-day documents. When a block on the chosen day is a TEST (the session's
 * "End-of-course TEST" checkbox, or the legacy "Test" note), the day's print
 * job also carries that course's Examination Rules & Disclosure form and an
 * Instructor Evaluation per lead instructor who taught the topic — pre-filled
 * from the schedule and the org's test info (question count + time limit,
 * Admin → Curriculum & Hours → Test info). Shared by the roster's "From
 * schedule" printout and the builder's day-print page so they never diverge.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { orgConfigPath, useDoc, type WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { can } from '../../../lib/rbac';
import type { AcademyDoc, CurriculumDoc, ReportConfigDoc, SessionDoc, UserDoc } from '../../../types';
import { ReportLetter } from '../reports/ReportLetter';
import { examCoursesOnDay } from './attendanceRoster';
import { courseKey } from './rosterShared';

type Sess = WithId<SessionDoc>;
const live = (s: Sess) => s.kind !== 'lunch' && s.status !== 'cancelled';

/** Class designation ("LE 131") — shortName plus the sequence number unless
 *  it's already part of shortName. Mirrors the Reports form's auto-fill. */
function classDesignation(academy: AcademyDoc): string {
  const sn = academy.shortName ?? '';
  const seq = academy.sequenceNo ?? '';
  return seq && !sn.includes(seq) ? [sn, seq].filter(Boolean).join(' ') : sn;
}

export function DayExamDocuments({
  academy,
  curriculum,
  sessions,
  users,
  dateStr,
  copies,
  pageBreakFirst,
}: {
  academy: WithId<AcademyDoc>;
  curriculum: WithId<CurriculumDoc> | null;
  sessions: Sess[];
  users: WithId<UserDoc>[];
  dateStr: string;
  /** How many of each form to render (1, or one per cadet). */
  copies: number;
  /** True when rosters precede these docs in the same print job. */
  pageBreakFirst: boolean;
}) {
  const { orgId, role } = useAuth();
  const { data: cfg } = useDoc<ReportConfigDoc>(orgId ? orgConfigPath('reportConfig', orgId) : null);
  const testCourses = examCoursesOnDay(sessions, dateStr);
  if (testCourses.length === 0) return null;

  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.displayName ?? '';
  const className = classDesignation(academy);
  const n = Math.max(1, copies);
  let first = !pageBreakFirst;
  const brk = () => {
    const cls = first ? '' : 'print:break-before-page';
    first = false;
    return cls;
  };

  return (
    <>
      {testCourses.map((courseName) => {
        const course = curriculum?.courses.find((c) => c.name === courseName);
        // Same label the Reports form stores for a 'course' field.
        const label = course?.cjk ? `${course.cjk.replace(/^CJK\s*/, 'CJK ')} — ${courseName}` : courseName;
        const info = curriculum && course ? cfg?.examInfo?.[curriculum.id]?.[courseKey(course)] : undefined;
        // Evaluate whoever LED the topic — every lead across the course's
        // blocks in this class (accounts + as-taught write-ins).
        const leads = new Set<string>();
        for (const s of sessions) {
          if (!live(s) || s.courseName !== courseName) continue;
          for (const slot of s.roleSlots ?? []) if (slot.role === 'lead') slot.filledBy.forEach((u) => { const nm = nameOf(u); if (nm) leads.add(nm); });
          for (const w of s.writeInInstructors ?? []) if (w.role === 'lead' && w.name) leads.add(w.name);
        }
        const instructors = leads.size ? [...leads] : [''];
        const missing = !info?.questions || !info?.minutes;
        return (
          <React.Fragment key={courseName}>
            <div className="no-print mb-3 mt-8 rounded-lg border border-watch-100 bg-watch-50 px-4 py-3 text-sm text-watch-800">
              <span className="font-semibold">Test day — {courseName}.</span> Printing the Examination Rules &amp; Disclosure
              form and {instructors.length === 1 ? 'an Instructor Evaluation' : `${instructors.length} Instructor Evaluations (one per lead)`}
              {n > 1 ? `, ${n} copies each` : ''}.
              {missing && (
                <span className="mt-1 block text-amber-800">
                  No question count / time limit on file for this course — those blanks will print empty.{' '}
                  {can.manageOrg(role) ? (
                    <><Link to="/admin/curriculum" className="font-semibold underline">Add them under Admin → Curriculum &amp; Hours → Test info</Link>.</>
                  ) : (
                    // Coordinators can't open Admin (sergeant+) — the link bounced them to the dashboard.
                    <>An admin can add them under Admin → Curriculum &amp; Hours → Test info.</>
                  )}
                </span>
              )}
            </div>
            {Array.from({ length: n }, (_, i) => (
              <div key={`rules-${i}`} className={brk()}>
                <ReportLetter
                  report={{
                    type: 'exam_rules',
                    cadetName: '',
                    data: {
                      course: label,
                      className,
                      examDate: dateStr,
                      questionCount: info?.questions ? String(info.questions) : '',
                      minutes: info?.minutes ? String(info.minutes) : '',
                      passingScore: '80',
                    },
                  }}
                  directorName=""
                  fromName=""
                  curriculum={curriculum}
                />
              </div>
            ))}
            {instructors.flatMap((instructorName) =>
              Array.from({ length: n }, (_, i) => (
                <div key={`eval-${instructorName}-${i}`} className={brk()}>
                  <ReportLetter
                    report={{
                      type: 'instructor_evaluation',
                      cadetName: '',
                      data: { course: label, className, instructorName, evalDate: dateStr },
                    }}
                    directorName=""
                    fromName=""
                    curriculum={curriculum}
                  />
                </div>
              ))
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
