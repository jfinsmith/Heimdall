/**
 * Built-in FDLE/CJSTC default curricula for the platform "Default Curricula"
 * page. The owner loads these once; new orgs are then auto-seeded from them.
 *
 * The Law Enforcement Basic Recruit program is the full, VERIFIED CJSTC
 * curriculum: 20 courses totalling 770 contact hours, with the four FDLE
 * high-liability courses and their instructor-to-student ratios (FAC
 * 11B-35.0021(8): Firearms 6:1, Defensive Tactics 8:1, Vehicle Operations
 * 1/vehicle, First Aid 10:1). Per-course CJK numbers, titles, and hours match the
 * current FDLE CMS edition (Florida Law Enforcement Academy catalog, 2025-26).
 *
 * Corrections / EOT / the two crossovers are provided as SHELLS (no courses) —
 * FDLE's public sources don't give a verifiable course/hour breakdown, so the
 * owner fills these in here and every new org inherits the result.
 */
import type { CurriculumCourse, CurriculumDoc } from '../../types';

type DefaultCurriculum = Omit<CurriculumDoc, 'orgId'>;

// Verified against the current FDLE CMS edition (Florida Law Enforcement Academy
// catalog, 2025-26). Core/operational courses first, then the high-liability and
// physical-skills courses. Sums to 770.
const LE_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0002', name: 'Introduction to Law Enforcement', minHours: 12, tested: true },
  { cjk: 'CJK0016', name: 'Communication', minHours: 24, tested: true },
  { cjk: 'CJK0018', name: 'Legal', minHours: 64, tested: true },
  { cjk: 'CJK0019', name: 'Interviewing and Report Writing', minHours: 56, tested: true },
  { cjk: 'CJK0021', name: 'Serving Your Community', minHours: 34, tested: true },
  { cjk: 'CJK0063', name: 'Fundamentals of Patrol', minHours: 40, tested: true },
  { cjk: 'CJK0072', name: 'Crimes Against Persons', minHours: 48, tested: true },
  { cjk: 'CJK0073', name: 'Crimes Involving Property and Society', minHours: 12, tested: true },
  { cjk: 'CJK0079', name: 'Crime Scene Follow-up Investigations', minHours: 34, tested: true },
  { cjk: 'CJK0093', name: 'Critical Incidents', minHours: 44, tested: true },
  { cjk: 'CJK0400', name: 'Traffic Incidents', minHours: 12, tested: true },
  { cjk: 'CJK0401', name: 'Traffic Stops', minHours: 24, tested: true },
  { cjk: 'CJK0402', name: 'Traffic Crash Investigations', minHours: 30, tested: true },
  { cjk: 'CJK0403', name: 'DUI Traffic Stops', minHours: 24, tested: true },
  { cjk: 'CJK0020', name: 'Law Enforcement Vehicle Operations', minHours: 48, tested: true, highLiability: true },
  { cjk: 'CJK0031', name: 'First Aid for Criminal Justice Officers', minHours: 40, tested: true, highLiability: true, instructorRatio: 10 },
  { cjk: 'CJK0040', name: 'Criminal Justice Firearms', minHours: 80, tested: true, highLiability: true, instructorRatio: 6 },
  { cjk: 'CJK0051', name: 'Criminal Justice Defensive Tactics', minHours: 80, tested: true, highLiability: true, instructorRatio: 8 },
  { cjk: 'CJK0096', name: 'Law Enforcement Officer Physical Fitness Training', minHours: 60 },
  { cjk: 'CJK0421', name: 'Conducted Electrical Weapon/Dart-Firing Stun Gun', minHours: 4, tested: true },
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
    totalHours: LE_COURSES.reduce((s, c) => s + c.minHours, 0), // 770 (verified)
    active: true,
    estimated: false,
    rosterModules: ['le_attendance', 'discipline', 'grades', 'reports'],
  },
  shell('co_brt', 'Corrections (Basic Recruit)', 'Florida Basic Recruit Training Program — Corrections'),
  shell('eot', 'Equivalency of Training (EOT)', 'FDLE Equivalency of Training'),
  shell('co_to_le', 'Crossover — Corrections to Law Enforcement', 'FDLE Crossover Program — Corrections to Law Enforcement'),
  shell('le_to_co', 'Crossover — Law Enforcement to Corrections', 'FDLE Crossover Program — Law Enforcement to Corrections'),
];
