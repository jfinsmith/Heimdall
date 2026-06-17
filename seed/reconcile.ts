/**
 * Reconcile LE 131 + LE 132 sessions to a clean, catalog-backed data model.
 *
 *  1. Upserts the full FDLE Law-Enforcement course catalog (names match the
 *     `le_brt` curriculum exactly, so curriculum coverage is an exact match —
 *     no fuzzy double-counting).
 *  2. Maps every existing session to either a catalog course (FDLE, counts
 *     toward hours) or a custom/agency block (coordinator-run, excluded from
 *     FDLE hours), moving distinguishers ("NIGHT", "Scenarios", "Classroom",
 *     tests…) into the notes shown on the calendar.
 *
 * Run: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx seed/reconcile.ts
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
let slotSeq = 0;
const sid = () => `rslot${(++slotSeq).toString(36).padStart(4, '0')}`;

// ── FDLE LE catalog (names == le_brt curriculum names) ──────────────────────
interface Cat {
  id: string;
  name: string;
  code: string;
  hours: number;
  hl: boolean;
  lead?: string;
  slots: { role: string; count: number; requiredQualificationKey?: string }[];
}
const CATALOG: Cat[] = [
  { id: 'intro-le', name: 'Introduction to Law Enforcement', code: 'CJK0002', hours: 12, hl: false, lead: 'general', slots: [] },
  { id: 'legal', name: 'Legal', code: 'CJK0018', hours: 64, hl: false, lead: 'general', slots: [] },
  { id: 'report-writing', name: 'Interviewing and Report Writing', code: 'CJK0019', hours: 56, hl: false, lead: 'general', slots: [] },
  { id: 'communications', name: 'Communication', code: 'CJK0016', hours: 24, hl: false, lead: 'general', slots: [] },
  { id: 'serving-community', name: 'Serving Your Community', code: 'CJK0021', hours: 34, hl: false, lead: 'general', slots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }] },
  { id: 'patrol-1', name: 'Fundamentals of Patrol', code: 'CJK0063', hours: 40, hl: false, lead: 'general', slots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }] },
  { id: 'crimes-persons', name: 'Crimes Against Persons', code: 'CJK0072', hours: 48, hl: false, lead: 'general', slots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }] },
  { id: 'crimes-property', name: 'Crimes Involving Property and Society', code: 'CJK0073', hours: 12, hl: false, lead: 'general', slots: [] },
  { id: 'crime-scene', name: 'Crime Scene Follow-Up Investigations', code: 'CJK0079', hours: 34, hl: false, lead: 'general', slots: [] },
  { id: 'critical-incidents', name: 'Critical Incidents', code: 'CJK0093', hours: 44, hl: false, lead: 'general', slots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }] },
  { id: 'traffic-stops', name: 'Traffic Stops', code: 'CJK0401', hours: 24, hl: false, lead: 'general', slots: [] },
  { id: 'traffic-crash', name: 'Traffic Crash Investigations', code: 'CJK0402', hours: 30, hl: false, lead: 'general', slots: [] },
  { id: 'dui', name: 'DUI Traffic Stops', code: 'CJK0403', hours: 24, hl: false, lead: 'general', slots: [] },
  { id: 'traffic-incidents', name: 'Traffic Incidents', code: 'CJK0400', hours: 12, hl: false, lead: 'general', slots: [] },
  { id: 'firearms', name: 'Criminal Justice Firearms', code: 'CJK0040', hours: 80, hl: true, lead: 'handgun', slots: [{ role: 'assistant', count: 2, requiredQualificationKey: 'handgun' }] },
  { id: 'dt', name: 'Criminal Justice Defensive Tactics', code: 'CJK0051', hours: 80, hl: true, lead: 'dt', slots: [{ role: 'assistant', count: 2, requiredQualificationKey: 'dt' }, { role: 'role_player', count: 4, requiredQualificationKey: 'role_player' }] },
  { id: 'dfsg', name: 'Dart-Firing Stun Gun (DFSG)', code: 'CJK0421', hours: 4, hl: true, lead: 'dt', slots: [] },
  { id: 'vehicle-ops', name: 'Law Enforcement Vehicle Operations', code: 'CJK0020', hours: 48, hl: true, lead: 'vehicle_ops', slots: [{ role: 'assistant', count: 3, requiredQualificationKey: 'vehicle_ops' }] },
  { id: 'first-aid', name: 'First Aid for Criminal Justice Officers', code: 'CJK0031', hours: 40, hl: true, lead: 'first_aid', slots: [{ role: 'assistant', count: 2, requiredQualificationKey: 'first_aid' }] },
  { id: 'pt', name: 'Physical Fitness Training', code: 'CJK0006', hours: 60, hl: false, lead: 'general', slots: [] },
];
const byId = new Map(CATALOG.map((c) => [c.id, c]));

async function upsertCatalog() {
  // Remove the old generic 'investigations' entry (superseded by FDLE courses).
  await db.doc('courseCatalog/investigations').delete().catch(() => {});
  for (const c of CATALOG) {
    await db.doc(`courseCatalog/${c.id}`).set({
      name: c.name,
      fdleCourseCode: c.code,
      discipline: 'all',
      defaultHours: c.hours,
      highLiability: c.hl,
      description: '',
      defaultRoleSlots: c.slots,
      leadRequiredQualificationKey: c.lead ?? null,
    });
  }
  console.log(`✓ courseCatalog upserted (${CATALOG.length} FDLE LE courses)`);
}

// ── Subject → catalog id (specific patterns first) ──────────────────────────
function matchCourse(low: string): string | null {
  if (/^pt\b|physical fitness/.test(low)) return 'pt';
  if (/dui/.test(low)) return 'dui';
  if (/traffic crash/.test(low)) return 'traffic-crash';
  if (/traffic stop/.test(low)) return 'traffic-stops';
  if (/traffic incident/.test(low)) return 'traffic-incidents';
  if (/crimes against persons/.test(low)) return 'crimes-persons';
  if (/property\s*(&|and)\s*society|involving property/.test(low)) return 'crimes-property';
  if (/crime scene/.test(low)) return 'crime-scene';
  if (/critical incident/.test(low)) return 'critical-incidents';
  if (/fundamentals of patrol|building clearing/.test(low)) return 'patrol-1';
  if (/serving your community/.test(low)) return 'serving-community';
  if (/interview|report writing/.test(low)) return 'report-writing';
  if (/introduction to (law|le)\b/.test(low)) return 'intro-le';
  if (/legal/.test(low)) return 'legal';
  if (/communicat/.test(low)) return 'communications';
  if (/vehicle op|levo/.test(low)) return 'vehicle-ops';
  if (/dart-firing|stun gun|dfsg/.test(low)) return 'dfsg';
  if (/firearm|night fire/.test(low)) return 'firearms';
  if (/defensive tactics/.test(low)) return 'dt';
  if (/first ?aid/.test(low)) return 'first-aid';
  return null;
}

// Standalone agency blocks (no FDLE course). "Working lunch"/"equipment" are
// incidental modifiers, NOT here — they must not override a real course match.
const AGENCY = /formation|^drill|\bdrill$|study|pso|resilien|\bart\b|human resources|hr benefit|cjs academy|shootout|k-?9|\bsoce\b|single officer response/i;

/** Build the calendar note from distinguishers + test flag. */
function noteFor(raw: string, courseId: string | null): string {
  const low = raw.toLowerCase();
  const parts: string[] = [];
  if (/\btest\b/.test(low)) parts.push('Test');
  if (/night fire/.test(low)) parts.push('Night fire');
  else if (/night/.test(low)) parts.push(courseId === 'vehicle-ops' ? 'Night driving' : 'Night');
  if (/scenarios?/.test(low)) parts.push('Scenarios');
  if (/classroom/.test(low)) parts.push('Classroom');
  if (/building clearing/.test(low)) parts.push('Building clearing');
  if (/active threat/.test(low)) parts.push('Active threat');
  if (/rubble pit/.test(low)) parts.push('Rubble pit');
  if (/\boc\b/.test(low)) parts.push('OC spray');
  if (/remedial|remediation/.test(low)) parts.push('Remedial');
  if (/reset/.test(low)) parts.push('Reset');
  if (/wellness/.test(low)) parts.push('Wellness');
  if (/leadership reaction/.test(low)) parts.push('Leadership reaction');
  if (/equipment issued/.test(low)) parts.push('Equipment issued');
  if (/gangs|extremist/.test(low)) parts.push('Gangs & extremist groups');
  if (/working lunch/.test(low)) parts.push('Working lunch');
  if (/initial assessment/.test(low)) parts.push('Initial assessment');
  else if (/final assessment/.test(low)) parts.push('Final assessment');
  else if (/assessment/.test(low)) parts.push('Assessment');
  if (/conop/.test(low)) parts.push('CONOP 101');
  if (/veh ops reset|veh ops/.test(low) && courseId === 'pt') parts.push('Veh Ops reset');
  return parts.join(' · ');
}

/** Tidy a custom/agency block name. */
function cleanCustom(raw: string): string {
  let n = raw.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  const ACR = /^(soce|pso|art|hr|cjs|k-?9)\b/i;
  if (n === n.toUpperCase() && !ACR.test(n)) {
    n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Friendly fixups
  n = n.replace(/^Pso\b/i, 'PSO').replace(/\bArt\b/, 'ART').replace(/\bCjs\b/, 'CJS');
  return n;
}

interface Reconciled {
  courseId: string;
  courseName: string;
  highLiability: boolean;
  countsTowardFdle: boolean;
  note: string;
  custom: boolean;
}

function reconcileSubject(raw: string): Reconciled {
  const low = raw.toLowerCase();
  const courseId = matchCourse(low);
  // Agency wins UNLESS it's clearly an FDLE physical-fitness block.
  const isAgency = AGENCY.test(low) && !/physical fitness|^pt\b/.test(low);
  if (isAgency || !courseId) {
    return {
      courseId: 'custom',
      courseName: cleanCustom(raw),
      highLiability: false,
      countsTowardFdle: false,
      note: '',
      custom: true,
    };
  }
  const cat = byId.get(courseId)!;
  return {
    courseId,
    courseName: cat.name,
    highLiability: cat.hl,
    countsTowardFdle: true,
    note: noteFor(raw, courseId),
    custom: false,
  };
}

async function reconcileAcademy(academyId: string): Promise<void> {
  const academySnap = await db.doc(`academies/${academyId}`).get();
  const coordinatorIds: string[] = academySnap.exists ? academySnap.data()!.coordinatorIds ?? [] : [];
  const defaultCoord = coordinatorIds[0];

  const snap = await db.collection('sessions').where('academyId', '==', academyId).get();
  let batch = db.batch();
  let n = 0;
  let custom = 0;
  for (const d of snap.docs) {
    const s = d.data();
    const rec = reconcileSubject(s.courseName as string);

    // Custom/agency blocks → a single coordinator slot (assigned if available);
    // FDLE sessions keep their existing slots.
    const roleSlots = rec.custom
      ? [{ slotId: sid(), role: 'coordinator', count: 1, requiredQualificationKey: null, filledBy: defaultCoord ? [defaultCoord] : [] }]
      : s.roleSlots;
    if (rec.custom) custom++;

    batch.update(d.ref, {
      courseId: rec.courseId,
      courseName: rec.courseName,
      highLiability: rec.highLiability,
      countsTowardFdle: rec.countsTowardFdle,
      notes: rec.note,
      roleSlots,
    });
    if (++n % 300 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  console.log(`✓ ${academyId}: reconciled ${snap.size} sessions (${custom} custom/agency, ${snap.size - custom} FDLE)`);
}

async function main() {
  console.log('Reconciling LE academies to catalog-backed courses…');
  await upsertCatalog();
  await reconcileAcademy('le-131');
  await reconcileAcademy('le-132');
  console.log('Done.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
