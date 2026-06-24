/**
 * Academic-action report registry. Each entry defines the form fields a
 * coordinator fills and the letter body used for the printable memorandum.
 *
 * `body`        — the Florida (FDLE/CJSTC) wording with current F.A.C. citations
 *                 (11B-35.001(10)(b), (13)(b); 11B-35.002(5)). Rendered for orgs
 *                 whose jurisdiction is 'FL' (the founding PHSC org).
 * `bodyNeutral` — a state-agnostic equivalent (no F.A.C./Florida-specific
 *                 citations) rendered for every other jurisdiction. A reasonable
 *                 default; orgs can author their own once the document builder ships.
 */
import React from 'react';
import type { ReportTypeId } from '../../../types';
import { DOCUMENT_TYPES } from './documentTypes';

export interface ReportField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'course' | 'textarea' | 'time' | 'select' | 'cadet';
  required?: boolean;
  /** Pre-fill the field from data the academy already knows (item 17):
   *  className = "{shortName} {sequenceNo}", sequenceNo, or program start–end dates. */
  defaultFrom?: 'className' | 'sequenceNo' | 'programDates';
  hint?: string;
  /** Choices for type 'select'. */
  options?: string[];
  /** Literal default value pre-filled in the form (e.g. a boilerplate statement). */
  default?: string;
}

/**
 * Block-model document spec (Phase 11). A `clause` block is LOCKED liability /
 * due-process / policy text rendered verbatim; a `paragraph` is ordinary prose.
 * In `text`, `{fieldKey}` is a fill-in (renders as an underlined blank showing
 * the filled value) and context tokens {cadetName} {fromName} {directorName}
 * {memoDate} {reSubject} resolve the same way. Header/signer/distribution
 * templates resolve the same tokens to PLAIN text.
 *
 * NOTE: this is DRAFT wording. Statutory/policy citations are intentionally left
 * as [bracketed placeholders] for the org's legal pass — never fabricated.
 */
export interface DocBlock {
  kind: 'paragraph' | 'clause';
  text: string;
}
export interface DocumentSpec {
  /** Drives the form (cadet recipient vs. file/general) and the record label. */
  appliesTo: 'cadet' | 'file' | 'general';
  /** To/From/CC/Date/Re rows; values are templates resolved to plain text. */
  headerFields: { label: string; value: string }[];
  blocks: DocBlock[];
  /** Authority signature template. */
  signerLine: string;
  /** Recipient acknowledgment sentence (empty = none). */
  acknowledgment?: string;
  ackSignerLabel?: string;
  distribution?: string[];
}

export interface ReportType {
  /** Built-in code ids are ReportTypeId; in-app builder docs (Phase 12) use their
   *  Firestore doc id — so this is a plain string. */
  id: ReportTypeId | string;
  name: string;
  purpose: string;
  reSubject: string; // "Re:" line + distribution footer subject
  fields: ReportField[];
  /** Florida (FDLE/CJSTC) body — verbatim legal text (academic letters only). */
  body?: (d: Record<string, string>) => React.ReactNode;
  /** Jurisdiction-neutral body (no state-specific citations). */
  bodyNeutral?: (d: Record<string, string>) => React.ReactNode;
  /**
   * Block-model document (Phase 11). When present, ReportLetter builds the
   * MemoDocument from this instead of the jsx body. The four academic letters
   * use `body`/`bodyNeutral`; the general & conduct documents use `document`.
   */
  document?: DocumentSpec;
  /**
   * Availability scope. undefined = GLOBAL (offered to every organization). A
   * specific orgId = offered ONLY to that org — used for documents custom-built
   * for one organization (e.g. the four PHSC academic-action letters are
   * 'phsc'-only). Set on the registry entry; AcademyReports filters on it.
   */
  orgScope?: string;
}

/** Underlined fill-in blank, mirroring the form's blanks. */
function U({ children }: { children?: React.ReactNode }) {
  const empty = children === undefined || children === null || children === '';
  return <span className="border-b border-black px-1 font-medium">{empty ? '     ' : children}</span>;
}
const label = (v?: string) => v || undefined;
/** Full canonical course reference, e.g. "CJK 0040 — Criminal Justice Firearms".
 *  Stored course values already carry the CJK prefix; this back-fills it for any
 *  legacy value saved before that format change. */
const courseRef = (v?: string) => (v ? (v.startsWith('CJK') ? v : `CJK ${v}`) : undefined);
/** Short course reference, e.g. "CJK 0040" — the CJK number only (handles both the
 *  new "CJK 0040 — Title" and legacy "0040 Title" stored forms). */
const courseShort = (v?: string) => {
  if (!v) return undefined;
  const m = v.match(/(\d{3,4})/);
  return m ? `CJK ${m[1]}` : v;
};

/** The four verbatim academic-action letters (FL/neutral jsx bodies). */
const ACADEMIC_REPORT_TYPES: ReportType[] = [
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
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{courseRef(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10)(b), F.A.C., "a student enrolled in a Commission-approved Basic Recruit Training Program … shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.001(13)(b), F.A.C., which provides for one written end-of-course re-examination during a single Basic Recruit Training Program, you are being provided the opportunity to retake the required written end-of-course examination for <U>{courseShort(d.course)}</U>. The re-examination is scheduled for <U>{label(d.reexamDate)}</U>. Please note that, regardless of the score you achieve on the re-examination, a passing grade will be recorded as 80%.</p>
        <p>Should you not attain a passing score on the re-examination, you will receive a grade of "F" for the course. Consequently, you will be required to retake <U>{courseShort(d.course)}</U> in its entirety at a future date. Per Rule 11B-35.002(5), F.A.C., you must successfully complete all courses required in the Basic Recruit Training Program to be eligible to take the State Officer Certification Examination; the Academy issues a Certificate of Completion upon successful completion of the program.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination, as established by the program's governing standards.</p>
        <p>You are being provided the opportunity to retake the required written end-of-course examination for <U>{courseShort(d.course)}</U>. The re-examination is scheduled for <U>{label(d.reexamDate)}</U>. Please note that, regardless of the score you achieve on the re-examination, a passing grade will be recorded as the minimum passing score.</p>
        <p>Should you not attain a passing score on the re-examination, you will receive a grade of "F" for the course and will be required to retake <U>{courseShort(d.course)}</U> in its entirety at a future date. Successful completion of this course, as well as all other courses required by the training program, is necessary for you to receive a certificate of completion and to become eligible for the certification examination.</p>
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
        <p>On <U>{label(d.proficiencyDate)}</U>, you failed to pass the required proficiencies, after being given ample time to prepare and remediation for <U>{courseRef(d.course)}</U>. Per Rule 11B-35.0024(1), F.A.C., "Students enrolled in a Commission-Approved Basic Recruit Training Program, Instructor Training Courses, or Specialized or Advanced Training Course shall qualify through demonstration of proficiency skill(s) in the applicable course(s) and pass a written end-of-course examination."</p>
        <p>You must complete a course retake of <U>{courseShort(d.course)}</U> at a future date. Per Rule 11B-35.002(5), F.A.C., you must successfully complete all courses required in the Basic Recruit Training Program to be eligible to take the State Officer Certification Examination; the Academy issues a Certificate of Completion and the examination voucher upon successful completion of the program.</p>
        <p>You will be able to continue in the Academy, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.proficiencyDate)}</U>, you failed to pass the required proficiencies, after being given ample time to prepare and remediation for <U>{courseRef(d.course)}</U>. Students enrolled in the basic recruit training program must qualify through demonstration of proficiency skill(s) in the applicable course(s) and pass a written end-of-course examination.</p>
        <p>You must complete a course retake of <U>{courseShort(d.course)}</U> at a future date. You must successfully complete and achieve a passing grade in all courses required by the training program in order to receive a certificate of completion and become eligible for the certification examination.</p>
        <p>You will be able to continue in the Academy, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
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
      { key: 'previousCourse', label: 'Previously Failed Course (re-exam already used)', type: 'course', required: true, hint: 'The course whose end-of-course re-examination opportunity was already used — may differ from the course above.' },
      { key: 'score', label: 'Score achieved (%)', type: 'number', required: true },
      { key: 'className', label: 'Academy class', type: 'text', required: true, defaultFrom: 'className', hint: 'e.g. LE 131' },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{courseRef(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10)(b), F.A.C., "a student enrolled in a Commission-approved Basic Recruit Training Program … shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.001(13)(b), F.A.C., which provides for one written end-of-course re-examination during a single Basic Recruit Training Program, you were already provided that re-examination for <U>{courseShort(d.previousCourse)}</U>.</p>
        <p>Therefore, you are no longer eligible to retake the end-of-course examination for <U>{courseShort(d.course)}</U>. You must complete a course retake of <U>{courseShort(d.course)}</U> at a future date. Per Rule 11B-35.002(5), F.A.C., you must successfully complete all courses required in the Basic Recruit Training Program to be eligible to take the State Officer Certification Examination; the Academy issues a Certificate of Completion upon successful completion of the program.</p>
        <p>You will be able to continue in the Academy <U>{label(d.className)}</U>, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination.</p>
        <p>You were already provided the opportunity to retake the required written end-of-course examination for <U>{courseShort(d.previousCourse)}</U>.</p>
        <p>Therefore, you are no longer eligible to retake the end-of-course examination for <U>{courseShort(d.course)}</U>. You must complete a course retake of <U>{courseShort(d.course)}</U> at a future date. You must successfully complete and achieve a passing grade in all courses required by the training program in order to receive a certificate of completion and be eligible for the certification examination.</p>
        <p>You will be able to continue in the Academy <U>{label(d.className)}</U>, however, if you receive a failing grade in any future courses, you will be dismissed from the Academy. You may be allowed to enroll in a future Academy upon receiving authorization from the Academy Director.</p>
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
      { key: 'previousCourse', label: 'Previously Failed Course (re-exam already used)', type: 'course', required: true, hint: 'The course whose end-of-course re-examination opportunity was already used — may differ from the 2nd-failure course above.' },
      { key: 'score', label: 'Score achieved (%)', type: 'number', required: true },
      { key: 'secondFailDate', label: 'Date of 2nd block failure', type: 'date', required: true },
      { key: 'className', label: 'Academy class', type: 'text', required: true, defaultFrom: 'className', hint: 'e.g. LE 131' },
    ],
    body: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{courseRef(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10)(b), F.A.C., "a student enrolled in a Commission-approved Basic Recruit Training Program … shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.001(13)(b), F.A.C., which provides for one written end-of-course re-examination during a single Basic Recruit Training Program, you were previously provided that re-examination for <U>{courseShort(d.previousCourse)}</U>.</p>
        <p>You did not qualify for a re-examination of <U>{courseShort(d.course)}</U> under the provisions of Rule 11B-35.001(13)(a)1.–3. and (13)(b), F.A.C.; therefore, you failed that block.</p>
        <p>As of <U>{label(d.secondFailDate)}</U> you have failed 2 blocks within the Basic Recruit Training Program. Per the Cadet Manual, Section 6.02. "Cadets who fail more than one course will be dismissed from the Basic Recruit Training Program." Therefore, you are officially dismissed from Class <U>{label(d.className)}</U>. You may enroll in a future Basic Recruit Training Academy and complete the program upon approval from the academy director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination.</p>
        <p>You were previously provided the opportunity to retake the required written end-of-course examination for <U>{courseShort(d.previousCourse)}</U>.</p>
        <p>You did not qualify for a re-examination of <U>{courseShort(d.course)}</U>; therefore you failed that block.</p>
        <p>As of <U>{label(d.secondFailDate)}</U> you have failed 2 blocks within the basic recruit training program. Per the Cadet Manual, cadets who fail more than one course will be dismissed from the program. Therefore, you are officially dismissed from Class <U>{label(d.className)}</U>. You may enroll in a future basic recruit training academy and complete the program upon approval from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
];

/** The built-in GENERAL forms: the four academic-action letters + the Phase-11
 *  general & conduct documents. All are available to every org (the FDLE letters
 *  are standard academy paperwork); orgs further tailor via the owner document
 *  library + per-curriculum overrides. These remain the legal source of the
 *  verbatim FDLE/CJSTC letter bodies. */
export const REPORT_TYPES: ReportType[] = [...ACADEMIC_REPORT_TYPES, ...DOCUMENT_TYPES];

export const getReportType = (id: string): ReportType | undefined => REPORT_TYPES.find((r) => r.id === id);
