/**
 * Import the agency's real October working schedule (parsed from
 * seed/oct-schedule.json — extracted from "OCT WORKING Schedule") into the
 * "LE ###" October Start TEMPLATE academy.
 *
 * Each PDF block becomes one session (faithful to how the schedule was built —
 * separate AM/PM blocks split by lunch). FDLE courses map to the catalog and
 * inherit its default role slots; agency blocks (Formation, PSO, CJS, video
 * presentations) become coordinator-run, non-FDLE. HOLIDAY/NO-CLASS rows are
 * skipped (the calendar shades holidays itself).
 *
 * Run: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx seed/import-oct-template.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const now = FieldValue.serverTimestamp();

const TEMPLATE_ID = 'UWCuQIMUlO3m4nJMiz82';
const LOCATION = 'PHSC — Dade City, FL';
let slotSeq = 0;
const sid = () => `oct${(++slotSeq).toString(36).padStart(4, '0')}`;

interface Row {
  date: string; start: string; end: string; hrs: string; subject: string; block: string; nature: string;
}

/** Subject (after stripping " - [NN]") → catalog course id. */
const COURSE_MAP: Record<string, string> = {
  'physical fitness training': 'pt',
  'defensive tactics': 'dt',
  firearms: 'firearms',
  legal: 'legal',
  'vehicle operations': 'vehicle-ops',
  'crimes against persons': 'crimes-persons',
  'interviewing & report writing': 'report-writing',
  'critical incidents': 'critical-incidents',
  'first aid': 'first-aid',
  'serving your community': 'serving-community',
  'crimes scene follow-up': 'crime-scene',
  'crime scene follow-up': 'crime-scene',
  'fundamentals of patrol': 'patrol-1',
  'traffic crash investigations': 'traffic-crash',
  communications: 'communications',
  communication: 'communications',
  'dui traffic stops': 'dui',
  'traffic stops': 'traffic-stops',
  'intro to law enforcement': 'intro-le',
  'introduction to law enforcement': 'intro-le',
  'crimes involving property & society': 'crimes-property',
  'crimes involving property and society': 'crimes-property',
  'traffic incidents': 'traffic-incidents',
  'dart-firing stun gun': 'dfsg',
};

/** Subjects that are agency-only (no FDLE hours), coordinator-run. */
function isAgency(subjLower: string): boolean {
  return /formation|pso|cjs academy|orientation|fivay|\bcte\b|lifeboat|sro video/.test(subjLower);
}
/** Rows that aren't sessions at all. */
function isNoClass(subjLower: string): boolean {
  return /no class|holiday/.test(subjLower);
}

function cleanSubject(raw: string): { name: string; noteFromName: string } {
  // Strip the " - [NN]" total-hours suffix; keep any trailing distinguisher.
  const m = raw.match(/^(.*?)\s*-\s*\[\d+\]\s*(.*)$/);
  if (m) return { name: m[1].trim(), noteFromName: m[2].trim() };
  return { name: raw.trim(), noteFromName: '' };
}

function parseTime(d: string, t: string): Date {
  return new Date(`${d}T${t.slice(0, 2)}:${t.slice(2)}:00`);
}
function isoDate(mdy: string): string {
  const [m, d, y] = mdy.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function main() {
  const rows: Row[] = JSON.parse(readFileSync('seed/oct-schedule.json', 'utf8'));

  // Pull catalog default slots + lead qual so FDLE sessions get proper staffing.
  const catSnap = await db.collection('courseCatalog').get();
  const catalog = new Map<string, any>();
  catSnap.forEach((d) => catalog.set(d.id, d.data()));

  // Wipe any existing sessions on the template, then rebuild.
  const existing = await db.collection('sessions').where('academyId', '==', TEMPLATE_ID).get();
  for (const d of existing.docs) await db.recursiveDelete(d.ref);
  console.log(`Cleared ${existing.size} existing template sessions.`);

  let batch = db.batch();
  let n = 0, fdle = 0, agency = 0, skipped = 0;
  let fdleHours = 0;
  let firstDate = '9999-99-99', lastDate = '0000-00-00';

  for (const r of rows) {
    const subjLower = r.subject.toLowerCase();
    if (isNoClass(subjLower)) { skipped++; continue; }

    const ds = isoDate(r.date);
    if (ds < firstDate) firstDate = ds;
    if (ds > lastDate) lastDate = ds;
    const start = parseTime(ds, r.start);
    let end = parseTime(ds, r.end);
    if (end <= start) end = new Date(start.getTime() + 36e5);
    const spanH = (end.getTime() - start.getTime()) / 36e5;
    const hours = r.hrs && !isNaN(parseFloat(r.hrs)) ? parseFloat(r.hrs) : Math.round(spanH * 4) / 4;

    const { name, noteFromName } = cleanSubject(r.subject);
    const agencyBlock = isAgency(subjLower);
    const courseId = agencyBlock ? 'custom' : COURSE_MAP[name.toLowerCase()] ?? 'custom';
    const cat = courseId !== 'custom' ? catalog.get(courseId) : null;
    const isCustom = courseId === 'custom';

    // Notes: prefer the NATURE column (PT Drill, TEST…), else any trailing bit.
    let notes = (r.nature || '').trim() || noteFromName;
    if (/test/i.test(notes)) notes = 'Test';

    const roleSlots = isCustom
      ? [{ slotId: sid(), role: 'coordinator', count: 1, requiredQualificationKey: null, filledBy: [] as string[] }]
      : [
          {
            slotId: sid(),
            role: 'lead',
            count: 1,
            requiredQualificationKey: cat?.leadRequiredQualificationKey ?? null,
            filledBy: [] as string[],
          },
          ...((cat?.defaultRoleSlots ?? []) as any[])
            .filter((s) => s.role !== 'lead')
            .map((s) => ({ slotId: sid(), role: s.role, count: s.count, requiredQualificationKey: s.requiredQualificationKey ?? null, filledBy: [] })),
        ];

    if (isCustom) agency++;
    else { fdle++; fdleHours += hours; }

    batch.set(db.doc(`sessions/${TEMPLATE_ID}-${String(n).padStart(3, '0')}`), {
      academyId: TEMPLATE_ID,
      courseId,
      courseName: isCustom ? cleanCustomName(name) : cat.name,
      highLiability: isCustom ? false : !!cat.highLiability,
      title: '',
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      location: LOCATION,
      room: '',
      hours,
      lunchMinutes: 0,
      lunchStart: '',
      countsTowardFdle: !isCustom,
      status: 'draft', // template sessions are drafts
      roleSlots,
      notes,
      createdBy: 'import',
      updatedAt: now,
    });
    if (++n % 300 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();

  // Update the template's dates/location to match the imported schedule.
  await db.doc(`academies/${TEMPLATE_ID}`).set(
    {
      startDate: Timestamp.fromDate(new Date(`${firstDate}T00:00:00`)),
      endDate: Timestamp.fromDate(new Date(`${lastDate}T23:59:59`)),
      location: LOCATION,
      defaultRoom: 'E-120',
      fdleProgram: 'Florida Basic Recruit Training Program — Law Enforcement (770 hrs)',
      targetTotalHours: 770,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`✓ Imported ${n} sessions into the LE ### October template`);
  console.log(`   ${fdle} FDLE (${fdleHours.toFixed(2)} hrs), ${agency} agency, ${skipped} no-class rows skipped`);
  console.log(`   Date range: ${firstDate} → ${lastDate}`);
}

function cleanCustomName(raw: string): string {
  let s = raw.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  // Title-case all-caps, keep known acronyms.
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b[\w-]+/g, (w) => w[0].toUpperCase() + w.slice(1));
  s = s.replace(/\bPso\b/g, 'PSO').replace(/\bCjs\b/g, 'CJS').replace(/\bCte\b/g, 'CTE').replace(/\bSro\b/g, 'SRO').replace(/\bHs\b/g, 'HS');
  return s;
}

main().catch((e) => { console.error(e); process.exit(1); });
