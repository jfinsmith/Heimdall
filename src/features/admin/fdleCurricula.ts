/**
 * Built-in FDLE/CJSTC platform curricula — the FIVE Florida programs that are the
 * single source of truth across every org. The owner loads these into the
 * `defaultCurricula` collection (Owner → Default Curricula → "Load FDLE standard
 * curricula"); every org reads them read-only and may add its own curricula below.
 *
 * Course data is research-verified (2026-06-23) against the FDLE/CJSTC CMS
 * curriculum under FAC 11B-35 (eff. 4/9/2025), the Florida DOE CTE Frameworks,
 * and multiple state-college catalogs (FSCJ, Broward, Gulf Coast, Chipola,
 * Florida Gateway, Hillsborough). Instructor ratios are verbatim from FAC
 * 11B-35.0021: Firearms 6:1, Defensive Tactics 8:1 (lead DT counted), First Aid
 * 10:1, Vehicle Operations one instructor per active vehicle (per-vehicle, not a
 * student ratio → recorded 0). `leadQualification` is the typical FDLE instructor
 * cert: General Instructor for classroom courses; the high-liability specialty
 * cert otherwise (Firearms→handgun, DT→dt, Vehicle Ops→vehicle_ops, First
 * Aid→first_aid; CEW soft-maps to the firearms/handgun cert).
 *
 * Confidence: LE (770) and Corrections (445) are HIGH. The two crossovers and EOT
 * carry caveats — see each program's note + the `estimated` flag.
 */
import type { CurriculumCourse, CurriculumDoc } from '../../types';

type DefaultCurriculum = Omit<CurriculumDoc, 'orgId'>;

// ── 1. Law Enforcement Basic Recruit — 770 hrs, 20 courses (HIGH confidence) ──
const LE_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0002', name: 'Introduction to Law Enforcement', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0016', name: 'Communication', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0018', name: 'Legal', minHours: 64, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0019', name: 'Interviewing and Report Writing', minHours: 56, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0021', name: 'Serving Your Community', minHours: 34, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0063', name: 'Fundamentals of Patrol', minHours: 40, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0072', name: 'Crimes Against Persons', minHours: 48, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0073', name: 'Crimes Involving Property and Society', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0079', name: 'Crime Scene Follow-up Investigations', minHours: 34, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0093', name: 'Critical Incidents', minHours: 44, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0400', name: 'Traffic Incidents', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0401', name: 'Traffic Stops', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0402', name: 'Traffic Crash Investigations', minHours: 30, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0403', name: 'DUI Traffic Stops', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0020', name: 'Law Enforcement Vehicle Operations', minHours: 48, tested: true, highLiability: true, leadQualification: 'vehicle_ops' },
  { cjk: 'CJK0031', name: 'First Aid for Criminal Justice Officers', minHours: 40, tested: true, highLiability: true, instructorRatio: 10, leadQualification: 'first_aid' },
  { cjk: 'CJK0040', name: 'Criminal Justice Firearms', minHours: 80, tested: true, highLiability: true, instructorRatio: 6, leadQualification: 'handgun' },
  { cjk: 'CJK0051', name: 'Criminal Justice Defensive Tactics', minHours: 80, tested: true, highLiability: true, instructorRatio: 8, leadQualification: 'dt' },
  { cjk: 'CJK0096', name: 'Criminal Justice Officer Physical Fitness Training/Law Enforcement', minHours: 60, leadQualification: 'general' },
  { cjk: 'CJK0421', name: 'Conducted Electrical Weapon/Dart-Firing Stun Gun', minHours: 4, leadQualification: 'handgun' },
];

// ── 2. Corrections Basic Recruit — 445 hrs, 13 courses (HIGH confidence) ──
const CO_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0301', name: 'Introduction to Corrections', minHours: 32, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0355', name: 'Legal for Correctional Officers', minHours: 22, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0306', name: 'Communications for Correctional Officers', minHours: 32, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0111', name: 'Interviewing and Report Writing in Corrections', minHours: 16, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0327', name: 'Shift Management and Safety', minHours: 20, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0321', name: 'Intake and Release', minHours: 16, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0324', name: 'Supervision in a Correctional Facility', minHours: 32, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0326', name: 'Supervising Correctional Populations', minHours: 25, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0336', name: 'Incidents and Emergencies in Correctional Facilities', minHours: 20, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0031', name: 'First Aid for Criminal Justice Officers', minHours: 40, tested: true, highLiability: true, instructorRatio: 10, leadQualification: 'first_aid' },
  { cjk: 'CJK0040', name: 'Criminal Justice Firearms', minHours: 80, tested: true, highLiability: true, instructorRatio: 6, leadQualification: 'handgun' },
  { cjk: 'CJK0051', name: 'Criminal Justice Defensive Tactics', minHours: 80, tested: true, highLiability: true, instructorRatio: 8, leadQualification: 'dt' },
  { cjk: 'CJK0340', name: 'Officer Wellness and Physical Abilities', minHours: 30, highLiability: true, leadQualification: 'dt' },
];

// ── 3. Crossover: Corrections → Law Enforcement — 518 hrs, 17 courses ──
// Legacy numbering (better-attested; Broward 2025-26 + Hillsborough + FLDOE).
// = the LE Basic courses MINUS the four a certified CO already holds (Firearms,
//   Defensive Tactics, First Aid, Physical Fitness) PLUS Cross-Over Updates.
const CO_TO_LE_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0002', name: 'Introduction to Law Enforcement', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0016', name: 'Communication', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0018', name: 'Legal', minHours: 64, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0019', name: 'Interviewing and Report Writing', minHours: 56, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0021', name: 'Serving Your Community', minHours: 34, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0063', name: 'Fundamentals of Patrol', minHours: 40, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0072', name: 'Crimes Against Persons', minHours: 48, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0073', name: 'Crimes Involving Property and Society', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0079', name: 'Crime Scene Follow-up Investigations', minHours: 34, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0093', name: 'Critical Incidents', minHours: 44, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0400', name: 'Traffic Incidents', minHours: 12, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0401', name: 'Traffic Stops', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0402', name: 'Traffic Crash Investigations', minHours: 30, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0403', name: 'DUI Traffic Stops', minHours: 24, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0020', name: 'Law Enforcement Vehicle Operations', minHours: 48, tested: true, highLiability: true, leadQualification: 'vehicle_ops' },
  { cjk: 'CJK0421', name: 'Conducted Electrical Weapon/Dart-Firing Stun Gun', minHours: 4, leadQualification: 'handgun' },
  { cjk: 'CJK0393', name: 'Cross-Over Program Updates', minHours: 8, leadQualification: 'general' },
];

// ── 4. Crossover: Law Enforcement → Corrections — documented roster 198 hrs ──
// FLAGGED: FDLE's published 2025.07 total is 223 hrs; the documented 9-course
// roster (Chipola + Gulf Coast) sums to 198. The unattributed +25 hrs (possibly a
// high-liability block) couldn't be sourced — `estimated: true`. Verify against
// the FDLE LEO-to-CO 2025.07 instructor guide and adjust.
const LE_TO_CO_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0300', name: 'Introduction to Corrections', minHours: 32, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0305', name: 'Communications', minHours: 40, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0310', name: 'Officer Safety', minHours: 16, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0315', name: 'Facility and Equipment', minHours: 8, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0320', name: 'Intake and Release', minHours: 18, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0325', name: 'Supervising in a Correctional Facility', minHours: 40, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0330', name: 'Supervising Special Populations', minHours: 20, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0335', name: 'Responding to Incidents and Emergencies', minHours: 16, tested: true, leadQualification: 'general' },
  { cjk: 'CJK0393', name: 'Cross-Over Program Updates', minHours: 8, leadQualification: 'general' },
];

// ── 5. Equivalency of Training (EOT) — proficiency PROCESS, not a fixed program ──
// EOT (FAC 11B-35.009) is an exemption/assessment process with no statewide fixed
// hour total. Populated with the four high-liability proficiency areas a candidate
// must demonstrate (hours are the full basic-recruit reference; actual EOT review
// is center-set). The candidate also passes the SOCE + four required online
// courses (Elder Abuse/Neglect, Human Trafficking, Recognizing Head Injuries in
// Infants/Children, Sexual Assault Investigations). `estimated: true`.
const EOT_COURSES: CurriculumCourse[] = [
  { cjk: 'CJK0040', name: 'Criminal Justice Firearms (proficiency demonstration)', minHours: 80, tested: true, highLiability: true, instructorRatio: 6, leadQualification: 'handgun' },
  { cjk: 'CJK0051', name: 'Criminal Justice Defensive Tactics (proficiency demonstration)', minHours: 80, tested: true, highLiability: true, instructorRatio: 8, leadQualification: 'dt' },
  { cjk: 'CJK0020', name: 'Law Enforcement Vehicle Operations (proficiency demonstration — LE only)', minHours: 48, tested: true, highLiability: true, leadQualification: 'vehicle_ops' },
  { cjk: 'CJK0031', name: 'First Aid for Criminal Justice Officers (proficiency demonstration)', minHours: 40, tested: true, highLiability: true, instructorRatio: 10, leadQualification: 'first_aid' },
];

const sum = (courses: CurriculumCourse[]) => courses.reduce((s, c) => s + c.minHours, 0);

export const FDLE_DEFAULT_CURRICULA: DefaultCurriculum[] = [
  {
    key: 'le_brt',
    label: 'Law Enforcement (Basic Recruit)',
    fdleProgram: 'Florida Basic Recruit Training Program — Law Enforcement',
    courses: LE_COURSES,
    totalHours: sum(LE_COURSES), // 770
    active: true,
    estimated: false,
    rosterModules: ['le_attendance', 'discipline', 'grades', 'reports'],
  },
  {
    key: 'co_brt',
    label: 'Corrections (Basic Recruit)',
    fdleProgram: 'Florida Basic Recruit Training Program — Corrections',
    courses: CO_COURSES,
    totalHours: sum(CO_COURSES), // 445
    active: true,
    estimated: false,
    rosterModules: ['discipline', 'grades', 'reports'],
  },
  {
    key: 'co_to_le',
    label: 'Crossover — Corrections to Law Enforcement',
    fdleProgram: 'FDLE Crossover Program — Corrections to Law Enforcement',
    courses: CO_TO_LE_COURSES,
    totalHours: sum(CO_TO_LE_COURSES), // 518
    active: true,
    estimated: false,
    rosterModules: ['discipline', 'grades', 'reports'],
  },
  {
    key: 'le_to_co',
    label: 'Crossover — Law Enforcement to Corrections',
    fdleProgram: 'FDLE Crossover Program — Law Enforcement to Corrections (ATMS #3019)',
    courses: LE_TO_CO_COURSES,
    totalHours: sum(LE_TO_CO_COURSES), // 198 documented (FDLE headline 223 — verify)
    active: true,
    estimated: true,
    rosterModules: ['discipline', 'grades', 'reports'],
  },
  {
    key: 'eot',
    label: 'Equivalency of Training (EOT)',
    fdleProgram: 'FDLE Equivalency of Training (proficiency process — FAC 11B-35.009)',
    courses: EOT_COURSES,
    totalHours: sum(EOT_COURSES), // reference hours; EOT review hours are center-set
    active: true,
    estimated: true,
    rosterModules: ['discipline', 'grades', 'reports'],
  },
];
