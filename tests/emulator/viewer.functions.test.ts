/**
 * Read-only VIEWER — server-side tests, run against the Firestore + Auth
 * emulators (never production):
 *   firebase emulators:exec --only firestore,auth "npm run test:emulator"
 *
 * Calls the real Cloud Functions handlers (functions/src) directly with a
 * Viewer's auth context and proves:
 *   1. getViewerStaffing returns classes, sessions, cadet COUNTS, names and open
 *      slots for the Viewer's own org — and no personal data at all;
 *   2. each Viewer sign-in is logged exactly once (by the token's auth_time);
 *   3. every other callable refuses the Viewer and the database is unchanged;
 *   4. notify() never notifies a Viewer.
 * Skips itself when the emulators are not running.
 */
import { createRequire } from 'module';
import { resolve } from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const hasEmulators = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
// A demo- project id can only ever reach the emulators.
const PROJECT = 'demo-heimdall-viewer';
const ORG = 'phsc';
const BETA = 'beta';

type Fn = { run: (req: unknown) => Promise<unknown>; __endpoint?: { callableTrigger?: unknown } };
type AdminDb = import('firebase-admin/firestore').Firestore;

let fns: Record<string, unknown>;
let db: AdminDb;
let listAuthUsers: () => Promise<number>;
let timeLib: typeof import('../../functions/src/viewer/time');
let notify: (opts: Record<string, unknown>) => Promise<void>;

const AUTH_TIME = 1_800_000_000; // seconds — a fixed sign-in moment
const viewerAuth = (over: Record<string, unknown> = {}, uid = 'vic') => ({
  uid,
  token: { role: 'viewer', orgId: ORG, auth_time: AUTH_TIME, ...over },
});
const req = (auth: unknown, data: unknown = {}) => ({
  auth,
  data,
  rawRequest: { ip: '203.0.113.7', headers: { 'user-agent': 'vitest' } },
});
const callable = (name: string) => fns[name] as Fn;

/** Every document in the database, keyed by path — to prove nothing changed. */
async function dump(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  async function walk(cols: FirebaseFirestore.CollectionReference[]) {
    for (const col of cols) {
      const snap = await col.get();
      for (const d of snap.docs) {
        out[d.ref.path] = d.data();
        await walk(await d.ref.listCollections());
      }
    }
  }
  await walk(await db.listCollections());
  return JSON.parse(JSON.stringify(out));
}

async function seed() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const today = timeLib.localDate(Date.now());
  const at = (dayOffset: number, hhmm: string) => {
    const date = timeLib.addDays(today, dayOffset);
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(timeLib.localMidnightMs(date) + (h * 60 + m) * 60_000);
  };
  const user = (o: Record<string, unknown>) => ({
    qualifications: [], verifiedQualKeys: [], notificationPrefs: { email: true, digest: true, reminderLeadHours: 48 }, ...o,
  });
  const w = db.batch();
  const set = (path: string, data: Record<string, unknown>) => w.set(db.doc(path), data);
  set(`orgs/${ORG}`, { orgId: ORG, legalName: 'PHSC', status: 'active' });
  set(`orgs/${BETA}`, { orgId: BETA, legalName: 'Beta', status: 'active' });
  set(`settings/${ORG}`, { orgName: 'PHSC Test', escalationRecipients: ['command.private@example.com'], siteCode: 'JOINSECRET' });
  set('users/vic', user({ role: 'viewer', status: 'active', orgId: ORG, displayName: 'Claude Assistant', email: 'viewer.private@example.com' }));
  set('users/vic2', user({ role: 'viewer', status: 'suspended', orgId: ORG, displayName: 'Old Viewer', email: 'v2@example.com' }));
  set('users/owner', user({ role: 'director', status: 'active', orgId: ORG, platformOwner: true, displayName: 'Owner', email: 'o@example.com' }));
  set('users/alice', user({
    role: 'instructor', status: 'active', orgId: ORG, displayName: 'Alice Adams', email: 'alice.private@example.com',
    phone: '555-867-5309', dob: '1985-02-03', icsToken: 'feedtoken-secret-123', cprCardUrl: 'https://files/secret-card.png',
    rank: 'Deputy', agency: 'PSO',
  }));
  set('users/bob', user({ role: 'instructor', status: 'active', orgId: ORG, displayName: 'Bob Brown', email: 'bob.private@example.com', phone: '555-111-2222' }));
  set('users/carol', user({ role: 'coordinator', status: 'active', orgId: ORG, displayName: 'Carol Cole', email: 'carol.private@example.com', dob: '1979-07-07' }));
  set('users/dave', user({ role: 'director', status: 'active', orgId: ORG, displayName: 'Dave Diaz', email: 'dave.private@example.com' }));
  set('users/erin', user({ role: 'director', status: 'active', orgId: BETA, displayName: 'Erin Beta', email: 'erin@example.com' }));
  const academy = (o: Record<string, unknown>) => ({
    discipline: 'le_brt', fdleProgram: 'Basic Recruit — LE', startDate: at(-30, '00:00'), endDate: at(120, '00:00'),
    coordinatorIds: ['carol'], location: 'Campus', createdBy: 'carol', ...o,
  });
  set('academies/aA', academy({ orgId: ORG, name: 'LE 133 (November Start)', shortName: 'LE 133', status: 'published' }));
  set('academies/aTpl', academy({ orgId: ORG, name: 'LE Template', shortName: 'LE T', status: 'draft', isTemplate: true }));
  set('academies/aArch', academy({ orgId: ORG, name: 'LE 120', shortName: 'LE 120', status: 'archived' }));
  set('academies/aB', academy({ orgId: BETA, name: 'Beta Class', shortName: 'BETA 1', status: 'published', coordinatorIds: ['erin'] }));
  const cadet = (o: Record<string, unknown>) => ({
    orgId: ORG, fullName: 'Cadet Secretname', dob: '1999-09-09', phone: '555-000-1111', email: 'cadet.private@example.com',
    cjis: 'CJIS-SECRET-1', studentId: 'SID-SECRET-1', emergencyName: 'Mom Secret', emergencyPhone: '555-999-0000', ...o,
  });
  set('academies/aA/roster/c1', cadet({ status: 'active' }));
  set('academies/aA/roster/c2', cadet({ status: 'active' }));
  set('academies/aA/roster/c3', cadet({ status: 'active', blockTaker: true }));
  set('academies/aA/roster/c4', cadet({ status: 'graduated' }));
  set('academies/aA/roster/c5', cadet({ status: 'withdrawn' }));
  set('academies/aA/roster/c6', cadet({ status: 'dismissed' }));
  const session = (o: Record<string, unknown>) => ({
    orgId: ORG, academyId: 'aA', courseId: 'c', courseName: 'Firearms', highLiability: true, title: '',
    location: 'Range', room: 'Range 2', hours: 9, roleSlots: [], createdBy: 'carol', ...o,
  });
  set('sessions/s1', session({
    start: at(1, '07:00'), end: at(1, '16:00'), status: 'open', includesTest: true,
    notes: 'Private note: call 555-222-3333',
    roleSlots: [
      { slotId: 'L', role: 'lead', count: 1, filledBy: ['alice'], requiredQualificationKey: 'firearms' },
      { slotId: 'A', role: 'assistant', count: 2, filledBy: ['carol'] },
    ],
    writeInInstructors: [{ name: 'Walt Writein', role: 'assistant' }],
  }));
  set('sessions/s1/signups/alice', { orgId: ORG, uid: 'alice', displayName: 'Alice Adams', role: 'lead', slotId: 'L', status: 'confirmed', reservationState: 'pending' });
  set('sessions/s1/signups/bob', { orgId: ORG, uid: 'bob', displayName: 'Bob Brown', role: 'assistant', slotId: 'A', status: 'waitlist' });
  set('sessions/s2', session({ academyId: 'aTpl', start: at(1, '07:00'), end: at(1, '08:00'), status: 'open', roleSlots: [{ slotId: 'L', role: 'lead', count: 1, filledBy: [] }] }));
  set('sessions/s3', session({ orgId: BETA, academyId: 'aB', start: at(1, '07:00'), end: at(1, '08:00'), status: 'open' }));
  set('sessions/s4', session({ kind: 'lunch', start: at(1, '12:00'), end: at(1, '13:00'), status: 'draft' }));
  set('sessions/s5', session({ start: at(2, '07:00'), end: at(2, '08:00'), status: 'cancelled', roleSlots: [{ slotId: 'L', role: 'lead', count: 1, filledBy: [] }] }));
  set('sessions/s6', session({ courseName: 'Defensive Tactics', start: at(3, '08:00'), end: at(3, '12:00'), status: 'fully_staffed', roleSlots: [{ slotId: 'L', role: 'lead', count: 1, filledBy: ['bob'] }] }));
  set('sessions/s7', session({ courseName: 'Vehicle Ops', start: at(4, '08:00'), end: at(4, '12:00'), status: 'scheduled', roleSlots: [{ slotId: 'L', role: 'lead', count: 1, filledBy: [] }] }));
  set('sessions/s8', session({ start: at(400, '08:00'), end: at(400, '09:00'), status: 'open' })); // outside the window
  set('assignments/s1_alice', { orgId: ORG, uid: 'alice', sessionId: 's1', academyId: 'aA', role: 'lead', status: 'confirmed', courseName: 'Firearms', start: at(1, '07:00'), end: at(1, '16:00') });
  set('notifications/old', { uid: 'alice', type: 'x', title: 't', body: 'b', read: false });
  await w.commit();
}

describe.skipIf(!hasEmulators)('Viewer — server functions', () => {
  beforeAll(async () => {
    process.env.GCLOUD_PROJECT = PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT });
    fns = await import('../../functions/src/index');
    timeLib = await import('../../functions/src/viewer/time');
    notify = (await import('../../functions/src/gjallarhorn/notify')).notify as never;
    // The SAME firebase-admin instance the functions use (functions/node_modules).
    const fromFunctions = createRequire(resolve('functions/package.json'));
    db = fromFunctions('firebase-admin/firestore').getFirestore();
    const auth = fromFunctions('firebase-admin/auth').getAuth();
    listAuthUsers = async () => (await auth.listUsers(1000)).users.length;
  }, 60_000);
  beforeEach(seed, 30_000);

  describe('getViewerStaffing — what a Viewer can read', () => {
    it('returns classes, sessions, cadet counts, names and open slots for its own org only', async () => {
      const res = (await callable('getViewerStaffing').run(req(viewerAuth()))) as Record<string, any>;
      expect(res.orgName).toBe('PHSC Test');
      // Only the live class: no template, no archived class, nothing from another org.
      expect(res.academies.map((a: any) => a.shortName)).toEqual(['LE 133']);
      const a = res.academies[0];
      expect(a.cadets).toEqual({ enrolled: 2, blockTakers: 1, graduated: 1, separated: 2 });
      expect(a.coordinators).toEqual(['Carol Cole']);
      // Sessions in the window: no lunch placeholder, no template/other-org, nothing past the range.
      expect(res.sessions.map((s: any) => s.id)).toEqual(['s1', 's5', 's6', 's7']);
      const s1 = res.sessions[0];
      expect(s1).toMatchObject({ course: 'Firearms', academy: 'LE 133', room: 'Range 2', start: '07:00', end: '16:00', test: true, staffing: 'understaffed', openSeats: 1 });
      expect(s1.slots).toEqual([
        { role: 'lead', requiredQualification: 'firearms', needed: 1, filled: [{ name: 'Alice Adams', awaitingConfirmation: true }], open: 0, waitlist: 0 },
        { role: 'assistant', requiredQualification: null, needed: 2, filled: [{ name: 'Carol Cole', awaitingConfirmation: false }], open: 1, waitlist: 1 },
      ]);
      expect(s1.writeIns).toEqual([{ name: 'Walt Writein', role: 'assistant' }]);
      expect(res.sessions.map((s: any) => s.staffing)).toEqual(['understaffed', 'cancelled', 'fully_staffed', 'not_open']);
      expect(res.totals).toEqual({ sessions: 3, understaffed: 1, fullyStaffed: 1, notOpen: 1, cancelled: 1, openSeats: 2 });
    });

    it('returns NO personal data: no contact details, birth dates, IDs, feed links, notes or cadet names', async () => {
      const res = await callable('getViewerStaffing').run(req(viewerAuth()));
      const text = JSON.stringify(res);
      for (const secret of [
        '555-', '1985-02-03', '1979-07-07', '1999-09-09', 'private@example.com', 'feedtoken-secret', 'secret-card',
        'CJIS-SECRET', 'SID-SECRET', 'Mom Secret', 'Secretname', 'Private note', 'JOINSECRET', 'Deputy', 'PSO',
      ]) {
        expect(text, `response must not contain "${secret}"`).not.toContain(secret);
      }
      const keys = new Set<string>();
      (function collect(v: unknown) {
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); collect(x); }
      })(res);
      for (const k of ['email', 'phone', 'dob', 'icsToken', 'cprCardUrl', 'cjis', 'studentId', 'emergencyName', 'emergencyPhone', 'notes', 'uid', 'rank', 'agency', 'address']) {
        expect(keys.has(k), `response must not have a "${k}" field`).toBe(false);
      }
    });

    it('logs each sign-in once, then counts page loads within it', async () => {
      const run = (authTime: number) => callable('getViewerStaffing').run(req(viewerAuth({ auth_time: authTime })));
      await run(AUTH_TIME);
      await run(AUTH_TIME);
      await run(AUTH_TIME + 3600);
      const logs = (await db.collection('auditLog').where('action', '==', 'viewer.sign_in').get()).docs.map((d) => d.data());
      expect(logs).toHaveLength(2);
      const first = logs.find((l) => l.signedInAt.toMillis() === AUTH_TIME * 1000)!;
      expect(first).toMatchObject({ actorUid: 'vic', orgId: ORG, ip: '203.0.113.7', userAgent: 'vitest', accessCount: 2 });
      expect(first.summary).toContain('Claude Assistant (Viewer) signed in');
    });

    it('refuses: suspended Viewer, mismatched profile or org, other roles, bad ranges, other orgs\' classes', async () => {
      const fn = callable('getViewerStaffing');
      const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as { code?: string }).code);
      expect(await code(fn.run(req(viewerAuth({}, 'vic2'))))).toBe('permission-denied');
      expect(await code(fn.run(req({ uid: 'alice', token: { role: 'viewer', orgId: ORG, auth_time: AUTH_TIME } })))).toBe('permission-denied');
      expect(await code(fn.run(req(viewerAuth({ orgId: BETA }))))).toBe('permission-denied');
      expect(await code(fn.run(req({ uid: 'alice', token: { role: 'instructor', orgId: ORG } })))).toBe('permission-denied');
      expect(await code(fn.run(req({ uid: 'dave', token: { role: 'director', orgId: ORG } })))).toBe('permission-denied');
      expect(await code(fn.run(req(undefined)))).toBe('unauthenticated');
      expect(await code(fn.run(req(viewerAuth(), { from: '2026-01-01', to: '2026-12-31' })))).toBe('invalid-argument');
      expect(await code(fn.run(req(viewerAuth(), { academyId: 'aB' })))).toBe('not-found');
      // Refused callers never get a sign-in entry (only the real Viewer above,
      // whose class filter missed, did).
      const loggedBy = async () => (await db.collection('auditLog').where('action', '==', 'viewer.sign_in').get()).docs.map((d) => d.data().actorUid);
      expect(await loggedBy()).toEqual(['vic']);
      // The platform owner may preview the page; that is not logged as a Viewer sign-in.
      expect(await code(fn.run(req({ uid: 'owner', token: { role: 'director', orgId: ORG, platformOwner: true } })))).toBe('ok');
      expect(await loggedBy()).toEqual(['vic']);
    });
  });

  describe('every other function refuses a Viewer, and nothing changes', () => {
    // Realistic inputs, so each refusal is about WHO is calling, not malformed data.
    const DATA: Record<string, unknown> = {
      submitSignup: { sessionId: 's1', slotId: 'A' },
      withdrawSignup: { sessionId: 's1' },
      confirmReservation: { sessionId: 's1' },
      checkInstructorConflict: { uid: 'alice', startMs: Date.now(), endMs: Date.now() + 3_600_000 },
      saveRoomReservation: { roomId: 'r1', title: 'Hold', startMs: Date.now(), endMs: Date.now() + 3_600_000 },
      deleteRoomReservation: { id: 'x' },
      requestNotificationEmail: { email: 'new.address@example.com' },
      confirmNotificationEmail: { code: '123456' },
      clearNotificationEmail: {},
      setUserRole: { uid: 'alice', role: 'coordinator' },
      createUserAccount: { email: 'new.member@example.com', displayName: 'New Member', role: 'instructor' },
      sendActivationEmail: { uid: 'alice', password: 'Temp-Password-1' },
      setUserSuspension: { uid: 'alice', suspended: true, reason: 'x' },
      setUserActive: { uid: 'alice', active: false },
      adminUpdateUser: { uid: 'alice', displayName: 'Changed' },
      adminDeleteAccount: { uid: 'alice' },
      denyUser: { uid: 'alice' },
      academyApproval: { academyId: 'aA', action: 'submit' },
      rosterCreateMember: { academyId: 'aA', member: { fullName: 'New Cadet' } },
      joinOrgByCode: { code: 'JOINSECRET' },
      acceptOrgDpa: { version: '2026-11-09' },
      createCheckoutSession: {},
      createBillingPortalSession: {},
      setFeedbackStatus: { id: 'x', status: 'resolved' },
      createOrg: { shortCode: 'x', legalName: 'X', allowedEmailDomains: [], jurisdiction: 'FL' },
      createOrgAdmin: { orgId: ORG, email: 'a@example.com', displayName: 'A', role: 'director' },
      assignUserToOrg: { uid: 'alice', orgId: BETA },
      setOrgComplimentary: { orgId: ORG, complimentary: false },
      setOrgSuspension: { orgId: ORG, suspended: true },
      deleteUnassignedAccount: { uid: 'alice' },
      ownerSwitchOrg: { orgId: BETA },
    };
    // Read-only views and public endpoints are not writes.
    const NOT_WRITES = new Set(['getViewerStaffing', 'getPublicClassPortal', 'listAllFeedback', 'listOwnerQueue', 'getOrgDetail', 'listAllAuditLog', 'ownerListOrgs']);

    it('lists every write function this test covers (so a new one cannot slip by untested)', () => {
      const callables = Object.entries(fns).filter(([, f]) => (f as Fn)?.__endpoint?.callableTrigger).map(([n]) => n);
      const writes = callables.filter((n) => !NOT_WRITES.has(n)).sort();
      expect(writes).toEqual(Object.keys(DATA).sort());
    });

    it('each one rejects the Viewer and leaves the database and accounts untouched', async () => {
      const before = await dump();
      const usersBefore = await listAuthUsers();
      const outcomes: Record<string, string> = {};
      for (const [name, data] of Object.entries(DATA)) {
        outcomes[name] = await callable(name).run(req(viewerAuth(), data)).then(
          () => 'ALLOWED',
          (e) => (e as { code?: string }).code ?? String(e)
        );
      }
      for (const [name, outcome] of Object.entries(outcomes)) {
        expect(['permission-denied', 'failed-precondition', 'unauthenticated'], `${name} → ${outcome}`).toContain(outcome);
      }
      expect(await dump()).toEqual(before);
      expect(await listAuthUsers()).toBe(usersBefore);
    });

    it('a SUSPENDED Viewer (role claim stripped) is refused everywhere too', async () => {
      const before = await dump();
      const locked = { uid: 'vic2', token: { orgId: ORG, status: 'suspended', auth_time: AUTH_TIME } };
      for (const [name, data] of Object.entries(DATA)) {
        const outcome = await callable(name).run(req(locked, data)).then(() => 'ALLOWED', (e) => (e as { code?: string }).code ?? String(e));
        expect(['permission-denied', 'failed-precondition', 'unauthenticated'], `${name} → ${outcome}`).toContain(outcome);
      }
      const page = await callable('getViewerStaffing').run(req(locked)).then(() => 'ALLOWED', (e) => (e as { code?: string }).code);
      expect(page).toBe('permission-denied');
      expect(await dump()).toEqual(before);
    });

    it('the owner-only read views refuse the Viewer too', async () => {
      for (const name of ['listAllFeedback', 'listOwnerQueue', 'getOrgDetail', 'listAllAuditLog', 'ownerListOrgs']) {
        const outcome = await callable(name).run(req(viewerAuth(), { orgId: ORG })).then(() => 'ALLOWED', (e) => (e as { code?: string }).code);
        expect(outcome, name).toBe('permission-denied');
      }
    });
  });

  describe('notifications', () => {
    it('notify() never writes a bell entry or an email for a Viewer, even when forced', async () => {
      await notify({ uid: 'vic', orgId: ORG, type: 'understaffed_alert', title: 'T', body: 'B', force: true, dedupeKey: 'viewer-test' });
      expect((await db.collection('notifications').where('uid', '==', 'vic').get()).size).toBe(0);
      const mail = await db.collection('mailQueue').get();
      expect(mail.docs.filter((d) => JSON.stringify(d.data().to).includes('viewer.private'))).toHaveLength(0);
      // Control: an instructor still gets the bell entry.
      await notify({ uid: 'alice', orgId: ORG, type: 'understaffed_alert', title: 'T', body: 'B', force: true, dedupeKey: 'alice-test' });
      expect((await db.collection('notifications').where('uid', '==', 'alice').get()).size).toBe(2);
    });
  });
});
