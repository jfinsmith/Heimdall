/**
 * Academic-action report registry. Each entry defines the form fields a
 * coordinator fills and the exact letter body (verbatim from the PHSC/FDLE
 * forms) used for the printable memorandum. These four are Law Enforcement only.
 */
import React from 'react';
import type { ReportTypeId } from '../../../types';

export interface ReportField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'course';
  required?: boolean;
  /** Default value source from the academy (e.g. shortName for the class). */
  defaultFrom?: 'className';
  hint?: string;
}

export interface ReportType {
  id: ReportTypeId;
  name: string;
  purpose: string;
  reSubject: string; // "Re:" line + distribution footer subject
  fields: ReportField[];
  body: (d: Record<string, string>) => React.ReactNode;
}

/** Underlined fill-in blank, mirroring the form's blanks. */
function U({ children }: { children?: React.ReactNode }) {
  const empty = children === undefined || children === null || children === '';
  return <span className="border-b border-black px-1 font-medium">{empty ? '     ' : children}</span>;
}
const label = (v?: string) => v || undefined;
const code = (v?: string) => (v ? v.split(' ')[0] : undefined);

export const REPORT_TYPES: ReportType[] = [
  {
    id: 'exam_failure',
    name: 'End-of-Course Exam Failure (1st)',
    purpose: 'First failure of a written end-of-course exam — the cadet is offered one re-examination.',
    reSubject: 'Failure of End-of-Course Examination',
    fields: [
      { key: 'examDate', label: 'Date of failed exam', type: 'date', required: true },
      { key: 'course', label: 'Course (CJK)', type: 'course', required: true },
      { key: 'score', label: 'Score achieved (%)', type: 'number', required: true },
      { key: 'reexamDate', label: 'Re-examination scheduled for', type: 'date', required: true },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for CJK <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10), F.A.C., Florida Administrative Code, "a student enrolled in a Commission Approved Basic Recruit Training Program shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.0024(2)(a), F.A.C., you are being provided the opportunity to retake the required written end-of-course examination for CJK <U>{code(d.course)}</U>. The re-examination is scheduled for <U>{label(d.reexamDate)}</U>. Please note that, regardless of the score you achieve on the re-examination, a passing grade will be recorded as 80%.</p>
        <p>Should you not attain a passing score on the re-examination, you will receive a grade of "F" for the course. Consequently, you will be required to retake CJK <U>{code(d.course)}</U> in its entirety at a future date. Successful completion of this course, as well as all other courses required in the Florida Basic Recruit Training Program, is necessary for you to receive a certificate of completion and to become eligible to take the State Officer Certification Exam.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
  {
    id: 'proficiency_fail',
    name: 'Proficiency / Course Failure',
    purpose: 'Cadet failed required proficiency skills after remediation — must retake the course; next failure means dismissal.',
    reSubject: 'Failure of End-of-Course Examination & Failure of Course',
    fields: [
      { key: 'proficiencyDate', label: 'Date proficiencies failed', type: 'date', required: true },
      { key: 'course', label: 'Course (CJK)', type: 'course', required: true },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.proficiencyDate)}</U>, you failed to pass the required proficiencies, after being given ample time to prepare and remediation for CJK <U>{label(d.course)}</U>. Per rule 11B-35.0024(1) F.A.C., "Students enrolled in a Commission-Approved Basic Recruit Training Program, Instructor Training Courses, or Specialized or Advanced Training Course shall qualify through demonstration of proficiency skill(s) in the applicable course(s) and pass a written end-of-course examination."</p>
        <p>You must complete a course retake of CJK <U>{code(d.course)}</U> at a future date. Per Rule 11B-35.0024 (1) F.A.C., you must successfully complete and achieve a passing grade in all courses required by the Florida CMS Law Enforcement Recruit Training Program in order to receive a Certificate of Completion and a voucher for the State Officer Certification Exam from Pasco-Hernando State College.</p>
        <p>You will be able to continue in PHSC Academy, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
  {
    id: 'exam_course_fail',
    name: 'Re-Exam Failure / Course Failure',
    purpose: 'Cadet failed the re-examination — no longer eligible to retake the exam; must redo the whole course. Next failure means dismissal.',
    reSubject: 'Failure of End-of-Course Examination & Failure of Course',
    fields: [
      { key: 'examDate', label: 'Date of failed exam', type: 'date', required: true },
      { key: 'course', label: 'Course (CJK)', type: 'course', required: true },
      { key: 'score', label: 'Score achieved (%)', type: 'number', required: true },
      { key: 'className', label: 'Academy class', type: 'text', required: true, defaultFrom: 'className', hint: 'e.g. LE 131' },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for CJK <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10), F.A.C., Florida Administrative Code "a student enrolled in a Commission-Approved Basic Recruit Training Program shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Florida Administrative Code, you were already provided the opportunity to retake the required written end-of-course examination for CJK <U>{code(d.course)}</U>.</p>
        <p>Therefore, you are no longer eligible to retake the end-of-course examination for CJK <U>{code(d.course)}</U>. You must complete a course retake of CJK <U>{code(d.course)}</U> at a future date. Per Rule 11B-35.002(4) F.A.C. you must successfully complete and achieve a passing grade in all courses required by the Basic Recruit Training Program in order to receive a Certification of Completion and be eligible to take the State Officer Certification Exam.</p>
        <p>You will be able to continue in PHSC Academy <U>{label(d.className)}</U>, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
  {
    id: 'academy_dismissal',
    name: 'Academy Dismissal',
    purpose: 'Cadet failed a second block — dismissed from the Basic Recruit Training Program.',
    reSubject: 'Academy Dismissal',
    fields: [
      { key: 'examDate', label: 'Date of failed exam', type: 'date', required: true },
      { key: 'course', label: 'Course (CJK) — 2nd failure', type: 'course', required: true },
      { key: 'score', label: 'Score achieved (%)', type: 'number', required: true },
      { key: 'secondFailDate', label: 'Date of 2nd block failure', type: 'date', required: true },
      { key: 'className', label: 'Academy class', type: 'text', required: true, defaultFrom: 'className', hint: 'e.g. LE 131' },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for CJK <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10), F.A.C., Florida Administrative Code, "a student enrolled in a Commission-Approved Basic Recruit Training Program shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.0024(2)(a), F.A.C., you were previously provided the opportunity to retake the required written end-of-course examination for CJK <U>{code(d.course)}</U>.</p>
        <p>You did not qualify for a re-examination of CJK <U>{code(d.course)}</U> course under the provisions of Rule 11B-35.001(13)(a), (1 - 2), or (b), F.A.C. therefore you failed that block.</p>
        <p>As of <U>{label(d.secondFailDate)}</U> you have failed 2 blocks within the Basic Recruit Training Program. Per the Cadet Manual, Section 6.02. "Cadets who fail more than one course will be dismissed from the Basic Recruit Training Program." Therefore, you are officially dismissed from Class <U>{label(d.className)}</U>. You may enroll in a future Basic Recruit Training Academy and complete the program upon approval from the academy director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
];

export const getReportType = (id: ReportTypeId): ReportType | undefined => REPORT_TYPES.find((r) => r.id === id);
