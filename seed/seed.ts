/**
 * HEIMDALL seed script (Firebase Admin SDK).
 *
 * Creates: settings/global, ~12 FDLE-style courses, one published academy
 * with ~4 weeks of sessions (PT blocks, classroom days, a Firearms day with
 * lead + 2 assistants + safety officer, a DT day with role players), and
 * sample users for every role — several with verified qualifications and a
 * few sessions already partially signed up, so dashboards and reminders are
 * demonstrable on first run.
 *
 * Run:  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run seed
 *
 * Demo Auth users are created with the password below — change or delete
 * them before any real use.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// TODO(setup): ensure GOOGLE_APPLICATION_CREDENTIALS points at your service-account JSON
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const auth = getAuth();

const DEMO_PASSWORD = 'Heimdall!Demo1'; // demo only — rotate/delete for real use
const now = FieldValue.serverTimestamp();

// ── Helpers ─────────────────────────────────────────────────────────────────
/** Next Monday at least a week out, so seeded sessions are in the future. */
function academyStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7) + 7);
  return d;
}
const START = academyStart();

function at(dayOffset: number, hh: number, mm = 0): Date {
  const d = new Date(START);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d;
}
const ts = (d: Date) => Timestamp.fromDate(d);
let slotSeq = 0;
const sid = () => `slot${(++slotSeq).toString(36).padStart(4, '0')}`;

// ── 0. Optional wipe (run with --wipe for a clean re-seed) ──────────────────
async function wipe() {
  console.log('Wiping demo collections (users & settings are preserved/overwritten in place)…');
  for (const col of ['sessions', 'assignments', 'academies', 'courseCatalog', 'notifications', 'bulkMessages', 'auditLog']) {
    const snap = await db.collection(col).get();
    for (const docSnap of snap.docs) {
      await db.recursiveDelete(docSnap.ref); // removes signups subcollections too
    }
    console.log(`  ✗ cleared ${col} (${snap.size} docs)`);
  }
}

// ── 1. Settings ─────────────────────────────────────────────────────────────
async function seedSettings() {
  await db.doc('settings/global').set({
    orgName: 'Pasco-Hernando State College — Basic Recruit Training Academy',
    brandPrimaryColor: '#16203a',
    brandAccentColor: '#d99320',
    logoUrl: '',
    allowedEmailDomains: [], // open registration for the demo
    reminderDefaultLeadHours: 48,
    understaffingAlertDays: 7,
    escalationRecipients: [], // filled with command uids below
    weeklyDigestEnabled: true,
    // Email starts OFF so initial setup/testing doesn't burn email quota —
    // flip the master switch under Admin → Gjallarhorn & Email when ready.
    emailMasterEnabled: false,
    emailAutomations: {}, // empty = every automation enabled (gated by master)
  });
  console.log('✓ settings/global (email master switch OFF for setup)');
}

// ── 2. Course catalog (FDLE BRTP-style) ─────────────────────────────────────
interface SeedCourse {
  id: string;
  name: string;
  fdleCourseCode: string;
  discipline: string;
  defaultHours: number;
  highLiability: boolean;
  description: string;
  leadRequiredQualificationKey?: string;
  defaultRoleSlots: { role: string; count: number; requiredQualificationKey?: string }[];
}

const COURSES: SeedCourse[] = [
  {
    id: 'intro-le', name: 'Introduction to Law Enforcement', fdleCourseCode: 'CJK_0007',
    discipline: 'law_enforcement', defaultHours: 10, highLiability: false,
    description: 'Orientation to the criminal justice system, ethics, and professionalism.',
    leadRequiredQualificationKey: 'general', defaultRoleSlots: [],
  },
  {
    id: 'legal', name: 'Legal', fdleCourseCode: 'CJK_0008',
    discipline: 'law_enforcement', defaultHours: 62, highLiability: false,
    description: 'Constitutional law, Florida statutes, search & seizure, use-of-force law.',
    leadRequiredQualificationKey: 'general', defaultRoleSlots: [],
  },
  {
    id: 'communications', name: 'Interactions in a Diverse Community / Communications', fdleCourseCode: 'CJK_0012',
    discipline: 'all', defaultHours: 40, highLiability: false,
    description: 'Interviewing, report-driven communication, de-escalation fundamentals.',
    leadRequiredQualificationKey: 'general', defaultRoleSlots: [],
  },
  {
    id: 'report-writing', name: 'Criminal Justice Communications (Report Writing)', fdleCourseCode: 'CJK_0013',
    discipline: 'all', defaultHours: 40, highLiability: false,
    description: 'Field notes, incident reports, testifying documentation.',
    leadRequiredQualificationKey: 'general', defaultRoleSlots: [],
  },
  {
    id: 'patrol-1', name: 'Fundamentals of Patrol', fdleCourseCode: 'CJK_0031',
    discipline: 'law_enforcement', defaultHours: 58, highLiability: false,
    description: 'Patrol techniques, calls for service, BOLOs, crimes in progress.',
    leadRequiredQualificationKey: 'general',
    defaultRoleSlots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }],
  },
  {
    id: 'investigations', name: 'Criminal Investigations', fdleCourseCode: 'CJK_0077',
    discipline: 'law_enforcement', defaultHours: 50, highLiability: false,
    description: 'Crime scene management, evidence, interviews, case preparation.',
    leadRequiredQualificationKey: 'general',
    defaultRoleSlots: [{ role: 'role_player', count: 2, requiredQualificationKey: 'role_player' }],
  },
  {
    id: 'first-aid', name: 'First Aid for Criminal Justice Officers', fdleCourseCode: 'CJK_0080',
    discipline: 'all', defaultHours: 40, highLiability: true,
    description: 'CPR/AED, trauma care, tactical casualty care. High-liability.',
    leadRequiredQualificationKey: 'first_aid',
    defaultRoleSlots: [
      { role: 'assistant', count: 2, requiredQualificationKey: 'first_aid' },
    ],
  },
  {
    id: 'firearms', name: 'Criminal Justice Firearms', fdleCourseCode: 'CJK_0040',
    discipline: 'all', defaultHours: 80, highLiability: true,
    description: 'Range fundamentals, qualification courses of fire, low-light. High-liability.',
    leadRequiredQualificationKey: 'handgun',
    defaultRoleSlots: [
      { role: 'assistant', count: 2, requiredQualificationKey: 'handgun' },
    ],
  },
  {
    id: 'dt', name: 'Criminal Justice Defensive Tactics (CMS)', fdleCourseCode: 'CJK_0051',
    discipline: 'all', defaultHours: 80, highLiability: true,
    description: 'Controlled-movement system, takedowns, handcuffing, ground survival. High-liability.',
    leadRequiredQualificationKey: 'dt',
    defaultRoleSlots: [
      { role: 'assistant', count: 2, requiredQualificationKey: 'dt' },
      { role: 'role_player', count: 4, requiredQualificationKey: 'role_player' },
    ],
  },
  {
    id: 'vehicle-ops', name: 'Criminal Justice Vehicle Operations', fdleCourseCode: 'CJK_0020',
    discipline: 'law_enforcement', defaultHours: 48, highLiability: true,
    description: 'Precision driving, pursuit policy, emergency vehicle operations. High-liability.',
    leadRequiredQualificationKey: 'vehicle_ops',
    defaultRoleSlots: [
      { role: 'assistant', count: 3, requiredQualificationKey: 'vehicle_ops' },
    ],
  },
  {
    id: 'dfsg', name: 'Dart-Firing Stun Gun (DFSG)', fdleCourseCode: 'CJK0421',
    discipline: 'all', defaultHours: 4, highLiability: true,
    description: 'Conducted electrical weapon certification block. High-liability.',
    leadRequiredQualificationKey: 'dt',
    defaultRoleSlots: [],
  },
  {
    id: 'pt', name: 'Physical Training (PT)', fdleCourseCode: 'LOCAL_PT',
    discipline: 'all', defaultHours: 1, highLiability: false,
    description: 'Daily physical conditioning block.',
    leadRequiredQualificationKey: 'general', defaultRoleSlots: [],
  },
];

async function seedCourses() {
  const batch = db.batch();
  for (const c of COURSES) {
    const { id, ...data } = c;
    batch.set(db.doc(`courseCatalog/${id}`), data);
  }
  await batch.commit();
  console.log(`✓ courseCatalog (${COURSES.length} courses)`);
}

// ── 3. Users (every role; varied verified qualifications) ──────────────────
interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
  rank: string;
  role: string;
  quals: { key: string; label: string; verified: boolean }[];
}

/** Qualification with the date the certifying course was attended. */
const Q = (key: string, label: string, attended: string, verified = true) => ({
  key,
  label,
  verified,
  attendedOn: Timestamp.fromDate(new Date(`${attended}T12:00:00`)),
});

const USERS: SeedUser[] = [
  { uid: 'director-frost', email: 'captain.frost@example.org', displayName: 'Capt. Dana Frost', rank: 'Captain', role: 'director', quals: [Q('general', 'General Instructor', '2019-08-12')] },
  { uid: 'lt-ramirez', email: 'lt.ramirez@example.org', displayName: 'Lt. Elena Ramirez', rank: 'Lieutenant', role: 'lieutenant', quals: [Q('general', 'General Instructor', '2020-03-02'), Q('handgun', 'Handgun Instructor', '2021-06-14')] },
  { uid: 'sgt-okafor', email: 'sgt.okafor@example.org', displayName: 'Sgt. Chidi Okafor', rank: 'Sergeant', role: 'sergeant', quals: [Q('general', 'General Instructor', '2021-01-25'), Q('dt', 'Defensive Tactics / CMS Instructor', '2022-04-18')] },
  { uid: 'coord-hale', email: 'coord.hale@example.org', displayName: 'Cpl. Morgan Hale', rank: 'Corporal', role: 'coordinator', quals: [Q('general', 'General Instructor', '2022-09-06')] },
  { uid: 'coord-bishop', email: 'coord.bishop@example.org', displayName: 'Dep. Riley Bishop', rank: 'Deputy', role: 'coordinator', quals: [Q('general', 'General Instructor', '2023-02-13')] },
  { uid: 'inst-vargas', email: 'inst.vargas@example.org', displayName: 'Dep. Sofia Vargas', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2023-05-22'), Q('handgun', 'Handgun Instructor', '2024-01-29'), Q('carbine', 'Carbine Instructor', '2024-08-05')] },
  { uid: 'inst-cole', email: 'inst.cole@example.org', displayName: 'Dep. Marcus Cole', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2022-11-07'), Q('handgun', 'Handgun Instructor', '2023-07-17')] },
  { uid: 'inst-nguyen', email: 'inst.nguyen@example.org', displayName: 'Dep. An Nguyen', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2023-03-13'), Q('dt', 'Defensive Tactics / CMS Instructor', '2024-02-26')] },
  { uid: 'inst-pratt', email: 'inst.pratt@example.org', displayName: 'Dep. Jordan Pratt', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2024-04-08'), Q('dt', 'Defensive Tactics / CMS Instructor', '2024-10-21'), Q('role_player', 'Role Player', '2024-10-21')] },
  { uid: 'inst-kimball', email: 'inst.kimball@example.org', displayName: 'Dep. Avery Kimball', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2023-08-14'), Q('first_aid', 'First Aid / CPR Instructor', '2025-01-13')] },
  { uid: 'inst-soto', email: 'inst.soto@example.org', displayName: 'Dep. Camila Soto', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2024-06-02'), Q('vehicle_ops', 'Vehicle Operations Instructor', '2025-03-10')] },
  { uid: 'inst-reyes', email: 'inst.reyes@example.org', displayName: 'Dep. Luis Reyes', rank: 'Deputy', role: 'instructor', quals: [Q('role_player', 'Role Player', '2025-02-03'), Q('general', 'General Instructor', '2025-09-15', false)] }, // general still pending verification
  { uid: 'inst-walsh', email: 'inst.walsh@example.org', displayName: 'Dep. Erin Walsh', rank: 'Deputy', role: 'instructor', quals: [Q('general', 'General Instructor', '2026-01-12', false)] }, // brand new, nothing verified yet
];

async function seedUsers() {
  for (const u of USERS) {
    // Auth user (idempotent) with demo password + role claim.
    try {
      await auth.createUser({ uid: u.uid, email: u.email, password: DEMO_PASSWORD, displayName: u.displayName });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'auth/uid-already-exists') throw err;
    }
    await auth.setCustomUserClaims(u.uid, { role: u.role });

    await db.doc(`users/${u.uid}`).set({
      email: u.email,
      displayName: u.displayName,
      photoURL: '',
      phone: '555-0100',
      rank: u.rank,
      agency: 'Example County Sheriff’s Office',
      role: u.role,
      status: 'active',
      qualifications: u.quals,
      verifiedQualKeys: u.quals.filter((q) => q.verified).map((q) => q.key),
      notificationPrefs: { email: true, reminderLeadHours: 48, digest: true },
      createdAt: now,
      updatedAt: now,
    });
  }
  // Wire command escalation recipients now that uids exist.
  await db.doc('settings/global').set(
    { escalationRecipients: ['director-frost', 'lt-ramirez', 'sgt-okafor'] },
    { merge: true }
  );
  console.log(`✓ users (${USERS.length}) — demo password: ${DEMO_PASSWORD}`);
}

// ── 4. Academy + ~4 weeks of sessions ───────────────────────────────────────
const ACADEMY_ID = 'le-131';

interface SeedSession {
  id: string;
  courseId: string;
  day: number;        // offset from academy start
  startH: number;
  endH: number;
  room: string;
  signups?: { uid: string; role: string }[]; // pre-filled sign-ups
}

function courseOf(id: string): SeedCourse {
  const c = COURSES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown course ${id}`);
  return c;
}

function buildSessions(): SeedSession[] {
  const sessions: SeedSession[] = [];
  // PT every weekday 0600–0700 for 4 weeks — lead rotates among generalists.
  const ptLeads = ['coord-hale', 'inst-nguyen', 'inst-vargas', 'inst-kimball', 'coord-bishop'];
  let pt = 0;
  for (let week = 0; week < 4; week++) {
    for (let dow = 0; dow < 5; dow++) {
      const day = week * 7 + dow;
      sessions.push({
        id: `pt-${day}`, courseId: 'pt', day, startH: 6, endH: 7, room: 'Track',
        // First two weeks of PT already staffed (demonstrates reminders).
        signups: week < 2 ? [{ uid: ptLeads[pt++ % ptLeads.length], role: 'lead' }] : [],
      });
    }
  }
  // Classroom blocks (0800–1700), mixed staffing states.
  const classroom: [string, string, number, { uid: string; role: string }[]][] = [
    ['intro-le', 'Rm 114', 0, [{ uid: 'coord-hale', role: 'lead' }]],
    ['legal', 'Rm 114', 1, [{ uid: 'coord-bishop', role: 'lead' }]],
    ['legal', 'Rm 114', 2, [{ uid: 'coord-bishop', role: 'lead' }]],
    ['legal', 'Rm 114', 3, []],
    ['communications', 'Rm 120', 4, [{ uid: 'inst-nguyen', role: 'lead' }]],
    ['communications', 'Rm 120', 7, []],
    ['report-writing', 'Rm 120', 8, [{ uid: 'inst-kimball', role: 'lead' }]],
    ['report-writing', 'Rm 120', 9, []],
    ['patrol-1', 'Rm 114', 10, [{ uid: 'coord-hale', role: 'lead' }, { uid: 'inst-pratt', role: 'role_player' }]],
    ['patrol-1', 'Rm 114', 11, []],
    ['investigations', 'Rm 118', 14, [{ uid: 'coord-bishop', role: 'lead' }, { uid: 'inst-reyes', role: 'role_player' }]],
    ['investigations', 'Rm 118', 15, []],
  ];
  for (const [courseId, room, day, signups] of classroom) {
    sessions.push({ id: `${courseId}-${day}`, courseId, day, startH: 8, endH: 17, room, signups });
  }
  // Firearms day — lead + 2 assistants + safety officer; partially staffed.
  sessions.push({
    id: 'firearms-16', courseId: 'firearms', day: 16, startH: 8, endH: 17, room: 'Range A',
    signups: [
      { uid: 'lt-ramirez', role: 'lead' },
      { uid: 'inst-vargas', role: 'assistant' },
      { uid: 'inst-cole', role: 'assistant' },
    ],
  });
  sessions.push({ id: 'firearms-17', courseId: 'firearms', day: 17, startH: 8, endH: 17, room: 'Range A', signups: [] });
  // DT day — lead/assistants covered, but 3 of 4 role-player slots
  // open (only two role-player-qualified instructors exist), so the staffing
  // board has a realistic high-liability gap to chase.
  sessions.push({
    id: 'dt-21', courseId: 'dt', day: 21, startH: 8, endH: 17, room: 'Mat Room',
    signups: [
      { uid: 'sgt-okafor', role: 'lead' },
      { uid: 'inst-nguyen', role: 'assistant' },
      { uid: 'inst-pratt', role: 'assistant' },
      { uid: 'inst-reyes', role: 'role_player' },
    ],
  });
  // Vehicle ops + first aid + DFST round out the calendar.
  sessions.push({
    id: 'vehicle-ops-22', courseId: 'vehicle-ops', day: 22, startH: 8, endH: 16, room: 'Driving Pad',
    signups: [{ uid: 'inst-soto', role: 'lead' }],
  });
  sessions.push({
    id: 'first-aid-23', courseId: 'first-aid', day: 23, startH: 8, endH: 17, room: 'Rm 118',
    signups: [{ uid: 'inst-kimball', role: 'lead' }],
  });
  sessions.push({ id: 'dfsg-24', courseId: 'dfsg', day: 24, startH: 8, endH: 16, room: 'Mat Room', signups: [] });
  return sessions;
}

async function seedAcademyAndSessions() {
  const endDate = at(27, 23, 59);
  await db.doc(`academies/${ACADEMY_ID}`).set({
    shortName: 'LE 131',
    name: 'LE 131 (May Start)',
    discipline: 'law_enforcement',
    fdleProgram: 'FDLE Basic Recruit Training Program — Law Enforcement (770 hrs)',
    startDate: ts(at(0, 0)),
    endDate: ts(endDate),
    location: 'PHSC — Dade City, FL',
    status: 'published',
    coordinatorIds: ['coord-hale', 'coord-bishop'],
    targetTotalHours: 770,
    createdBy: 'director-frost',
    createdAt: now,
    updatedAt: now,
  });

  const sessions = buildSessions();
  for (const s of sessions) {
    const course = courseOf(s.courseId);
    const start = at(s.day, s.startH);
    const end = at(s.day, s.endH);

    // Build slots from the course defaults.
    const slots = [
      { slotId: sid(), role: 'lead', count: 1, requiredQualificationKey: course.leadRequiredQualificationKey ?? null, filledBy: [] as string[] },
      ...course.defaultRoleSlots.map((d) => ({
        slotId: sid(), role: d.role, count: d.count,
        requiredQualificationKey: d.requiredQualificationKey ?? null, filledBy: [] as string[],
      })),
    ];

    // Apply pre-filled sign-ups (skip duplicates / overflow defensively).
    const applied: { uid: string; role: string; slotId: string }[] = [];
    for (const su of s.signups ?? []) {
      const slot = slots.find((sl) => sl.role === su.role && sl.filledBy.length < sl.count && !sl.filledBy.includes(su.uid));
      const alreadyInSession = applied.some((a) => a.uid === su.uid);
      if (!slot || alreadyInSession) continue;
      slot.filledBy.push(su.uid);
      applied.push({ uid: su.uid, role: su.role, slotId: slot.slotId });
    }

    const fullyStaffed = slots.every((sl) => sl.filledBy.length >= sl.count);
    await db.doc(`sessions/${s.id}`).set({
      academyId: ACADEMY_ID,
      courseId: s.courseId,
      courseName: course.name,
      highLiability: course.highLiability,
      title: '',
      start: ts(start),
      end: ts(end),
      location: 'PHSC — Dade City, FL',
      room: s.room,
      hours: s.endH - s.startH,
      status: fullyStaffed ? 'fully_staffed' : 'open',
      roleSlots: slots,
      notes: '',
      createdBy: 'coord-hale',
      updatedAt: now,
    });

    // Mirror signups + assignments for each applied sign-up.
    for (const a of applied) {
      const user = USERS.find((u) => u.uid === a.uid)!;
      await db.doc(`sessions/${s.id}/signups/${a.uid}`).set({
        uid: a.uid,
        displayName: user.displayName,
        role: a.role,
        slotId: a.slotId,
        status: 'confirmed',
        signedUpAt: now,
      });
      await db.doc(`assignments/${s.id}_${a.uid}`).set({
        uid: a.uid,
        sessionId: s.id,
        academyId: ACADEMY_ID,
        role: a.role,
        courseName: course.name,
        location: 'PHSC — Dade City, FL',
        room: s.room,
        start: ts(start),
        end: ts(end),
        status: 'confirmed',
        reminderSent: false,
        createdAt: now,
      });
    }
  }
  console.log(`✓ academy "${ACADEMY_ID}" with ${sessions.length} sessions (published, partially staffed)`);
}

// ── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding HEIMDALL demo data (academy starts ${START.toDateString()})…`);
  if (process.argv.includes('--wipe')) await wipe();
  await seedSettings();
  await seedCourses();
  await seedUsers();
  await seedAcademyAndSessions();
  await db.collection('auditLog').add({
    actorUid: 'system',
    action: 'seed.run',
    targetType: 'system',
    targetId: 'seed',
    summary: 'Seed script populated demo data',
    createdAt: now,
  });
  console.log('Done. Sign in as e.g. coord.hale@example.org / ' + DEMO_PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
