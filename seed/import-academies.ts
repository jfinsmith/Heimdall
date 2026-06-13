/**
 * Import real PHSC academies from extracted spreadsheet JSON
 * (seed/le131-schedule.json, seed/le132-schedule.json — produced from the
 * agency's master schedule workbooks), and seed the FDLE curricula.
 *
 * - Replaces ALL existing academies/sessions/assignments (users, settings and
 *   courseCatalog are kept; courseCatalog gets the DFSG rename).
 * - Sessions import WITHOUT instructors: future = 'scheduled' (visible on the
 *   calendar, sign-ups closed until coordinators open each course), past =
 *   'completed'.
 * - Curricula hours per FDLE Active Courses Master v2025.07 (eff. 07/01/2025),
 *   verified via Santa Fe College / FSCJ program pages. EOT is a proficiency
 *   process, so its hours are estimates (flagged in the UI).
 *
 * Run: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx seed/import-academies.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const now = FieldValue.serverTimestamp();

const LOCATION = 'PHSC — Dade City, FL';
let slotSeq = 0;
const sid = () => `slot${(++slotSeq).toString(36).padStart(4, '0')}`;

// ── Curricula (FDLE Active Courses Master v2025.07) ─────────────────────────
const CURRICULA = [
  {
    key: 'le_brt',
    label: 'Law Enforcement (Basic Recruit)',
    fdleProgram: 'Florida Basic Recruit Training Program — Law Enforcement (770 hrs)',
    estimated: false,
    courses: [
      { name: 'Introduction to Law Enforcement', minHours: 12 },
      { name: 'Legal', minHours: 64 },
      { name: 'Interviewing and Report Writing', minHours: 56 },
      { name: 'Communication', minHours: 24 },
      { name: 'Serving Your Community', minHours: 34 },
      { name: 'Fundamentals of Patrol', minHours: 40 },
      { name: 'Crimes Against Persons', minHours: 48 },
      { name: 'Crimes Involving Property and Society', minHours: 12 },
      { name: 'Crime Scene Follow-Up Investigations', minHours: 34 },
      { name: 'Critical Incidents', minHours: 44 },
      { name: 'Traffic Stops', minHours: 24 },
      { name: 'Traffic Crash Investigations', minHours: 30 },
      { name: 'DUI Traffic Stops', minHours: 24 },
      { name: 'Traffic Incidents', minHours: 12 },
      { name: 'Criminal Justice Firearms', minHours: 80 },
      { name: 'Criminal Justice Defensive Tactics', minHours: 80 },
      { name: 'Dart-Firing Stun Gun (DFSG)', minHours: 4 },
      { name: 'Law Enforcement Vehicle Operations', minHours: 48 },
      { name: 'First Aid for Criminal Justice Officers', minHours: 40 },
      { name: 'Physical Fitness Training', minHours: 60 },
    ],
  },
  {
    key: 'co_brt',
    label: 'Corrections (Basic Recruit)',
    fdleProgram: 'Florida Basic Recruit Training Program — Corrections (445 hrs, v2025.07)',
    estimated: false,
    courses: [
      { name: 'Introduction to Corrections', minHours: 32 },
      { name: 'Legal for Correctional Officers', minHours: 22 },
      { name: 'Communications for Correctional Officers', minHours: 32 },
      { name: 'Interviewing and Report Writing in Corrections', minHours: 16 },
      { name: 'Intake and Release', minHours: 16 },
      { name: 'Supervision in a Correctional Facility', minHours: 32 },
      { name: 'Supervising Correctional Populations', minHours: 25 },
      { name: 'Shift Management and Safety', minHours: 20 },
      { name: 'Incidents and Emergencies in Correctional Facilities', minHours: 20 },
      { name: 'Physical Fitness for Criminal Justice Officers', minHours: 30 },
      { name: 'First Aid for Criminal Justice Officers', minHours: 40 },
      { name: 'Criminal Justice Firearms', minHours: 80 },
      { name: 'Criminal Justice Defensive Tactics', minHours: 80 },
    ],
  },
  {
    key: 'xo_co_le',
    label: 'Cross-Over: Corrections → Law Enforcement',
    fdleProgram: 'Correctional Officer Cross-Over to Law Enforcement (518 hrs, v2025.07)',
    estimated: false,
    courses: [
      { name: 'Introduction to Law Enforcement', minHours: 12 },
      { name: 'Communication', minHours: 24 },
      { name: 'Legal', minHours: 64 },
      { name: 'Interviewing and Report Writing', minHours: 56 },
      { name: 'Law Enforcement Vehicle Operations', minHours: 48 },
      { name: 'Serving Your Community', minHours: 34 },
      { name: 'Fundamentals of Patrol', minHours: 40 },
      { name: 'Crimes Against Persons', minHours: 48 },
      { name: 'Crimes Involving Property and Society', minHours: 12 },
      { name: 'Crime Scene Follow-Up Investigations', minHours: 34 },
      { name: 'Traffic Incidents', minHours: 12 },
      { name: 'Traffic Stops', minHours: 24 },
      { name: 'Traffic Crash Investigations', minHours: 30 },
      { name: 'DUI Traffic Stops', minHours: 24 },
      { name: 'Critical Incidents', minHours: 44 },
      { name: 'Dart-Firing Stun Gun (DFSG)', minHours: 4 },
      { name: 'Cross-Over Program Updates', minHours: 8 },
    ],
  },
  {
    key: 'xo_le_co',
    label: 'Cross-Over: Law Enforcement → Corrections',
    fdleProgram: 'Law Enforcement Cross-Over to Correctional Officer (223 hrs, v2025.07)',
    estimated: false,
    courses: [
      { name: 'Introduction to Corrections', minHours: 32 },
      { name: 'Legal for Correctional Officers', minHours: 22 },
      { name: 'Communications for Correctional Officers', minHours: 32 },
      { name: 'Interviewing and Report Writing in Corrections', minHours: 16 },
      { name: 'Intake and Release', minHours: 16 },
      { name: 'Supervision in a Correctional Facility', minHours: 32 },
      { name: 'Supervising Correctional Populations', minHours: 25 },
      { name: 'Shift Management and Safety', minHours: 20 },
      { name: 'Incidents and Emergencies in Correctional Facilities', minHours: 20 },
      { name: 'Cross-Over Program Updates', minHours: 8 },
    ],
  },
  {
    key: 'eot',
    label: 'EOT — Equivalency of Training',
    fdleProgram: 'Equivalency of Training (proficiency process, Rule 11B-35.009(7)) — hours estimated',
    estimated: true,
    courses: [
      { name: 'Firearms Proficiency Demonstration', minHours: 80 },
      { name: 'Defensive Tactics Proficiency Demonstration', minHours: 80 },
      { name: 'First Aid Proficiency Demonstration', minHours: 40 },
      { name: 'Vehicle Operations Proficiency Demonstration (LE only)', minHours: 48 },
      { name: 'Recognizing Head Injuries in Infants and Children', minHours: 1 },
      { name: 'Identify and Investigate Human Trafficking', minHours: 4 },
      { name: 'Elder Abuse Investigations', minHours: 4 },
      { name: 'Sexual Assault Investigations', minHours: 2 },
      { name: 'Lethality Assessment Training', minHours: 1 },
    ],
  },
];

// ── Subject → catalog course matching ───────────────────────────────────────
const CATALOG_MATCHERS: [RegExp, string][] = [
  [/firearm|shotgun|range/i, 'firearms'],
  [/defensive tactics|\bdt\b/i, 'dt'],
  [/vehicle op|levo|driving/i, 'vehicle-ops'],
  [/first aid|cpr|medical/i, 'first-aid'],
  [/stun gun|dfsg|taser|cew/i, 'dfsg'],
  [/physical fitness|\bpt\b/i, 'pt'],
  [/legal/i, 'legal'],
  [/report writing|interview/i, 'report-writing'],
  [/communicat/i, 'communications'],
  [/patrol/i, 'patrol-1'],
  [/introduction to law/i, 'intro-le'],
];

const HIGH_LIABILITY = /firearm|shotgun|defensive tactics|vehicle op|first aid|stun gun|dfsg|taser|range/i;

/**
 * Agency-only blocks (member minimum-hours work, not FDLE curriculum).
 * Everything else counts toward the program hours — including tests and the
 * FDLE subjects that aren't in the reusable course catalog.
 */
const AGENCY_BLOCK =
  /formation|drill|study|pso |pso$|\*\*\*|resilien|orientation|log[- ]?in|vision (board|brd)|equipment issued|hr benefits|shootout|graduation|ceremony|uniform|barber|locker/i;

interface Row {
  date: string;
  start: string;
  end: string;
  hours: number | null;
  subject: string;
  block: string;
  room: string;
}

function matchCatalog(subject: string): string {
  for (const [re, id] of CATALOG_MATCHERS) if (re.test(subject)) return id;
  return 'custom';
}

async function wipeScheduleData() {
  for (const col of ['sessions', 'assignments', 'academies']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) await db.recursiveDelete(d.ref);
    console.log(`  ✗ cleared ${col} (${snap.size})`);
  }
}

async function seedCurricula() {
  for (const c of CURRICULA) {
    const totalHours = c.courses.reduce((s, x) => s + x.minHours, 0);
    await db.doc(`curricula/${c.key}`).set({ ...c, totalHours, active: true });
    console.log(`  ✓ curricula/${c.key} — ${totalHours} hrs`);
  }
}

async function renameDfsg() {
  const old = await db.doc('courseCatalog/dfst').get();
  if (old.exists) await db.doc('courseCatalog/dfst').delete();
  await db.doc('courseCatalog/dfsg').set({
    name: 'Dart-Firing Stun Gun (DFSG)',
    fdleCourseCode: 'CJK0421',
    discipline: 'all',
    defaultHours: 4,
    highLiability: true,
    description: 'Conducted electrical weapon certification block. High-liability.',
    defaultRoleSlots: [{ role: 'safety_officer', count: 1, requiredQualificationKey: 'dt' }],
    leadRequiredQualificationKey: 'dt',
  });
  console.log('  ✓ courseCatalog: DFST → DFSG');
}

async function importAcademy(
  id: string,
  shortName: string,
  name: string,
  jsonPath: string
): Promise<void> {
  const rows: Row[] = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const dates = rows.map((r) => r.date).sort();
  const startDate = new Date(`${dates[0]}T00:00:00`);
  const endDate = new Date(`${dates[dates.length - 1]}T23:59:59`);

  await db.doc(`academies/${id}`).set({
    shortName,
    name,
    discipline: 'le_brt',
    fdleProgram: 'Florida Basic Recruit Training Program — Law Enforcement (770 hrs)',
    startDate: Timestamp.fromDate(startDate),
    endDate: Timestamp.fromDate(endDate),
    location: LOCATION,
    defaultRoom: 'E-120',
    status: startDate <= new Date() ? 'in_progress' : 'published',
    coordinatorIds: [],
    targetTotalHours: 770,
    createdBy: 'import',
    createdAt: now,
    updatedAt: now,
  });

  let batch = db.batch();
  let count = 0;
  for (const [i, r] of rows.entries()) {
    const start = new Date(`${r.date}T${r.start.slice(0, 2)}:${r.start.slice(2)}:00`);
    let end = new Date(`${r.date}T${r.end.slice(0, 2)}:${r.end.slice(2)}:00`);
    if (end <= start) end = new Date(start.getTime() + 36e5); // guard malformed ranges
    const courseId = matchCatalog(r.subject);
    const highLiability = HIGH_LIABILITY.test(r.subject);
    const past = end < new Date();

    batch.set(db.doc(`sessions/${id}-s${String(i).padStart(3, '0')}`), {
      academyId: id,
      courseId,
      courseName: r.subject,
      highLiability,
      title: '',
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      location: LOCATION,
      room: r.room || '',
      hours: r.hours ?? Math.round(((end.getTime() - start.getTime()) / 36e5) * 4) / 4,
      countsTowardFdle: !AGENCY_BLOCK.test(r.subject),
      // Visible on the calendar; sign-ups stay closed until coordinators open
      // each course. Past sessions import as completed.
      status: past ? 'completed' : 'scheduled',
      roleSlots: [
        { slotId: sid(), role: 'lead', count: 1, requiredQualificationKey: null, filledBy: [] },
      ],
      notes: r.block && r.block !== 'NA' && r.block !== '0' ? `Block ${r.block}` : '',
      createdBy: 'import',
      updatedAt: now,
    });
    if (++count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  console.log(`  ✓ ${shortName}: ${rows.length} sessions (${dates[0]} → ${dates[dates.length - 1]})`);
}

async function main() {
  console.log('Importing PHSC academies + FDLE curricula…');
  await wipeScheduleData();
  await seedCurricula();
  await renameDfsg();
  await importAcademy('le-131', 'LE 131', 'LE 131 (May Start)', 'seed/le131-schedule.json');
  await importAcademy('le-132', 'LE 132', 'LE 132 (July Start)', 'seed/le132-schedule.json');
  await db.collection('auditLog').add({
    actorUid: 'system',
    action: 'import.academies',
    targetType: 'system',
    targetId: 'import',
    summary: 'Imported LE 131 + LE 132 from master schedule workbooks; seeded FDLE curricula',
    createdAt: now,
  });
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
