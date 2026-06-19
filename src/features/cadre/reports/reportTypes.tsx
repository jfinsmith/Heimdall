/**
 * Academic-action report registry. Each entry defines the form fields a
 * coordinator fills and the letter body used for the printable memorandum.
 *
 * `body`        — the Florida (FDLE/CJSTC) wording, VERBATIM from the official
 *                 PHSC forms (F.A.C. rule citations etc.). Rendered for orgs whose
 *                 jurisdiction is 'FL' (the founding PHSC org). Do not edit — it's
 *                 the legal text of record.
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
  /** Default value source from the academy (e.g. shortName for the class). */
  defaultFrom?: 'className';
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
const code = (v?: string) => (v ? v.split(' ')[0] : undefined);

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
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for CJK <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Pursuant to Rule 11B-35.001(10), F.A.C., Florida Administrative Code, "a student enrolled in a Commission Approved Basic Recruit Training Program shall achieve a score of no less than 80% on each of the written end-of-course examinations."</p>
        <p>In accordance with Rule 11B-35.0024(2)(a), F.A.C., you are being provided the opportunity to retake the required written end-of-course examination for CJK <U>{code(d.course)}</U>. The re-examination is scheduled for <U>{label(d.reexamDate)}</U>. Please note that, regardless of the score you achieve on the re-examination, a passing grade will be recorded as 80%.</p>
        <p>Should you not attain a passing score on the re-examination, you will receive a grade of "F" for the course. Consequently, you will be required to retake CJK <U>{code(d.course)}</U> in its entirety at a future date. Successful completion of this course, as well as all other courses required in the Florida Basic Recruit Training Program, is necessary for you to receive a certificate of completion and to become eligible to take the State Officer Certification Exam.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination, as established by the program's governing standards.</p>
        <p>You are being provided the opportunity to retake the required written end-of-course examination for <U>{code(d.course)}</U>. The re-examination is scheduled for <U>{label(d.reexamDate)}</U>. Please note that, regardless of the score you achieve on the re-examination, a passing grade will be recorded as the minimum passing score.</p>
        <p>Should you not attain a passing score on the re-examination, you will receive a grade of "F" for the course and will be required to retake <U>{code(d.course)}</U> in its entirety at a future date. Successful completion of this course, as well as all other courses required by the training program, is necessary for you to receive a certificate of completion and to become eligible for the certification examination.</p>
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
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.proficiencyDate)}</U>, you failed to pass the required proficiencies, after being given ample time to prepare and remediation for <U>{label(d.course)}</U>. Students enrolled in the basic recruit training program must qualify through demonstration of proficiency skill(s) in the applicable course(s) and pass a written end-of-course examination.</p>
        <p>You must complete a course retake of <U>{code(d.course)}</U> at a future date. You must successfully complete and achieve a passing grade in all courses required by the training program in order to receive a certificate of completion and become eligible for the certification examination.</p>
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
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination.</p>
        <p>You were already provided the opportunity to retake the required written end-of-course examination for <U>{code(d.course)}</U>.</p>
        <p>Therefore, you are no longer eligible to retake the end-of-course examination for <U>{code(d.course)}</U>. You must complete a course retake of <U>{code(d.course)}</U> at a future date. You must successfully complete and achieve a passing grade in all courses required by the training program in order to receive a certificate of completion and be eligible for the certification examination.</p>
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
    bodyNeutral: (d) => (
      <>
        <p>On <U>{label(d.examDate)}</U> you did not achieve a passing score on the final written end-of-course examination for <U>{label(d.course)}</U> with a score of (<U>{label(d.score)}</U>%).</p>
        <p>Your basic recruit training program requires a minimum passing score on each written end-of-course examination.</p>
        <p>You were previously provided the opportunity to retake the required written end-of-course examination for <U>{code(d.course)}</U>.</p>
        <p>You did not qualify for a re-examination of <U>{code(d.course)}</U>; therefore you failed that block.</p>
        <p>As of <U>{label(d.secondFailDate)}</U> you have failed 2 blocks within the basic recruit training program. Per the Cadet Manual, cadets who fail more than one course will be dismissed from the program. Therefore, you are officially dismissed from Class <U>{label(d.className)}</U>. You may enroll in a future basic recruit training academy and complete the program upon approval from the Academy Director.</p>
        <p>Please contact the Academy office if you have any questions or require further clarification.</p>
      </>
    ),
  },
];

/** The full registry: academic-action letters + Phase-11 general & conduct documents.
 *  The four academic letters are PHSC-specific (built from PHSC's official forms),
 *  so they're scoped to 'phsc'; the general & conduct documents are global. */
export const REPORT_TYPES: ReportType[] = [
  ...ACADEMIC_REPORT_TYPES.map((t) => ({ ...t, orgScope: 'phsc' })),
  ...DOCUMENT_TYPES,
];

export const getReportType = (id: string): ReportType | undefined => REPORT_TYPES.find((r) => r.id === id);
