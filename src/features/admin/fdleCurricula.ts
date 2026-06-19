/**
 * Built-in FDLE/CJSTC default curricula for the platform "Default Curricula"
 * page. The owner loads these once; new orgs are then auto-seeded from them.
 *
 * The Law Enforcement Basic Recruit program is fully populated with the verified
 * CJK course numbers, the four FDLE high-liability courses, and their
 * instructor-to-student ratios (FAC 11B-35.0021(8): Firearms 6:1, Defensive
 * Tactics 8:1, Vehicle Operations 1/vehicle, First Aid 10:1). PER-COURSE HOURS
 * ARE ESTIMATES (flagged `estimated`) — the verified total is 770; confirm the
 * per-topic split against the current FDLE CMS edition.
 *
 * Corrections / EOT / the two crossovers are provided as SHELLS (no courses) —
 * FDLE's public sources don't give a verifiable course/hour breakdown, so the
 * owner fills these in here and every new org inherits the result.
 */
import type { CurriculumCourse, CurriculumDoc } from '../../types';

type DefaultCurriculum = Omit<CurriculumDoc, 'orgId'>;

const LE_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0001', name: 'Introduction to Law Enforcement', minHours: 30, tested: true },
  { cjk: 'CJK0012', name: 'Legal', minHours: 60, tested: true },
  { cjk: 'CJK0013', name: 'Interactions in a Diverse Community', minHours: 24, tested: true },
  { cjk: 'CJK0014', name: 'Interviewing and Report Writing', minHours: 40, tested: true },
  { cjk: 'CJK0020', name: 'Law Enforcement Vehicle Operations', minHours: 48, tested: true, highLiability: true },
  { cjk: 'CJK0031', name: 'First Aid for Criminal Justice Officers', minHours: 40, tested: true, highLiability: true, instructorRatio: 10 },
  { cjk: 'CJK0040', name: 'Criminal Justice Firearms', minHours: 80, tested: true, highLiability: true, instructorRatio: 6 },
  { cjk: 'CJK0051', name: 'Criminal Justice Defensive Tactics', minHours: 80, tested: true, highLiability: true, instructorRatio: 8 },
  { cjk: 'CJK0064', name: 'Fundamentals of Patrol', minHours: 40, tested: true },
  { cjk: 'CJK0065', name: 'Calls for Service', minHours: 48, tested: true },
  { cjk: 'CJK0077', name: 'Criminal Investigations', minHours: 60, tested: true },
  { cjk: 'CJK0078', name: 'Crime Scene to Courtroom', minHours: 30, tested: true },
  { cjk: 'CJK0092', name: 'Critical Incidents', minHours: 30, tested: true },
  { cjk: 'CJK0087', name: 'Traffic Stops', minHours: 32, tested: true },
  { cjk: 'CJK0084', name: 'DUI Traffic Stops', minHours: 24, tested: true },
  { cjk: 'CJK0088', name: 'Traffic Crash Investigations', minHours: 32, tested: true },
  { cjk: 'CJK0096', name: 'Physical Fitness Training', minHours: 64 },
  { cjk: 'CJK0422', name: 'Dart-Firing Stun Gun', minHours: 8, tested: true },
];

const shell = (key: string, label: string, fdleProgram: string): DefaultCurriculum => ({
  key,
  label,
  fdleProgram,
  courses: [],
  totalHours: 0,
  active: true,
  estimated: true,
});

export const FDLE_DEFAULT_CURRICULA: DefaultCurriculum[] = [
  {
    key: 'le_brt',
    label: 'Law Enforcement (Basic Recruit)',
    fdleProgram: 'Florida Basic Recruit Training Program — Law Enforcement',
    courses: LE_COURSES,
    totalHours: LE_COURSES.reduce((s, c) => s + c.minHours, 0), // 770
    active: true,
    estimated: true,
    rosterModules: ['le_attendance', 'discipline', 'grades', 'reports'],
  },
  shell('co_brt', 'Corrections (Basic Recruit)', 'Florida Basic Recruit Training Program — Corrections'),
  shell('eot', 'Equivalency of Training (EOT)', 'FDLE Equivalency of Training'),
  shell('co_to_le', 'Crossover — Corrections to Law Enforcement', 'FDLE Crossover Program — Corrections to Law Enforcement'),
  shell('le_to_co', 'Crossover — Law Enforcement to Corrections', 'FDLE Crossover Program — Law Enforcement to Corrections'),
];
