/**
 * Firestore SECURITY RULES tests (TEST-1) — run against the emulator:
 *   firebase emulators:exec --only firestore,auth "npm run test:emulator"
 * (needs Java). These assert the RBAC matrix the UI relies on, the SEC-1
 * self-escalation fix, AND Phase-5 multi-tenant isolation (orgId), against the
 * real firestore.rules file.
 */
import { readFileSync } from 'fs';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, where, setDoc, updateDoc, addDoc, deleteDoc, collection } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const ORG = 'phsc';   // primary tenant under test
const BETA = 'beta';  // a second tenant, to prove isolation

const user = (over: Record<string, unknown> = {}) => ({
  email: 'x@y.z', displayName: 'X', role: 'instructor', status: 'active',
  qualifications: [], verifiedQualKeys: [], ...over,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'heimdall-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed baseline docs with rules disabled. Everything is tenant ORG ('phsc')
  // except the BETA-tenant docs used by the isolation suite.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), user({ role: 'instructor', status: 'active', orgId: ORG }));
    await setDoc(doc(db, 'users/bob'), user({ role: 'instructor', status: 'active', orgId: ORG }));
    await setDoc(doc(db, 'users/carol'), user({ role: 'coordinator', status: 'active', orgId: ORG }));
    await setDoc(doc(db, 'users/dave'), user({ role: 'director', status: 'active', orgId: ORG }));
    await setDoc(doc(db, 'users/pat'), user({ role: 'instructor', status: 'pending', orgId: ORG }));
    await setDoc(doc(db, 'sessions/s1'), { academyId: 'a1', status: 'open', roleSlots: [], start: new Date(), orgId: ORG });
    await setDoc(doc(db, 'sessions/draft'), { academyId: 'a1', status: 'draft', roleSlots: [], start: new Date(), orgId: ORG });
    await setDoc(doc(db, 'settings/' + ORG), { orgName: 'PHSC' });

    // ── BETA tenant (for isolation tests) ──
    await setDoc(doc(db, 'users/erin'), user({ role: 'director', status: 'active', orgId: BETA }));
    await setDoc(doc(db, 'academies/aA'), { orgId: ORG, status: 'published', isTemplate: false, title: 'A' });
    await setDoc(doc(db, 'academies/aB'), { orgId: BETA, status: 'published', isTemplate: false, title: 'B' });
    await setDoc(doc(db, 'academies/aDraft'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'Draft', approval: { state: 'pending_captain' } });
    await setDoc(doc(db, 'academies/aApproved'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'Approved', approval: { state: 'approved' } });
    await setDoc(doc(db, 'academies/aB/roster/m1'), { orgId: BETA, fullName: 'Cadet B', status: 'active' });
    await setDoc(doc(db, 'sessions/sB'), { academyId: 'aB', status: 'open', roleSlots: [], start: new Date(), orgId: BETA });
    await setDoc(doc(db, 'settings/' + BETA), { orgName: 'Beta College' });
    await setDoc(doc(db, 'auditLog/lB'), { actorUid: 'erin', action: 'x', summary: 's', orgId: BETA });
    await setDoc(doc(db, 'orgs/' + ORG), { orgId: ORG, legalName: 'PHSC' });
    await setDoc(doc(db, 'orgs/' + BETA), { orgId: BETA, legalName: 'Beta College' });
    // documentForms (Phase 12) — one per tenant, for the isolation suite.
    await setDoc(doc(db, 'documentForms/dfA'), { orgId: ORG, name: 'A doc', active: true });
    await setDoc(doc(db, 'documentForms/dfB'), { orgId: BETA, name: 'B doc', active: true });
    // curricula are org-namespaced ({orgId}__{key}); same base key across tenants.
    await setDoc(doc(db, 'curricula/' + ORG + '__le_brt'), { orgId: ORG, key: 'le_brt', label: 'LE' });
    await setDoc(doc(db, 'curricula/' + BETA + '__le_brt'), { orgId: BETA, key: 'le_brt', label: 'LE' });
    // defaultCurricula: the platform FDLE programs (no orgId — shared across orgs).
    await setDoc(doc(db, 'defaultCurricula/le_brt'), { key: 'le_brt', label: 'LE platform', courses: [], totalHours: 770 });
    await setDoc(doc(db, 'reportConfig/' + ORG), { categories: [] });
    await setDoc(doc(db, 'reportConfig/' + BETA), { categories: [] });
    // documentLibrary: a general form + one specialized per tenant.
    await setDoc(doc(db, 'roomCategories/catA'), { orgId: ORG, name: 'College' });
    await setDoc(doc(db, 'roomCategories/catB'), { orgId: BETA, name: 'College' });
    await setDoc(doc(db, 'rooms/roomA'), { orgId: ORG, categoryId: 'catA', name: 'E-120', active: true });
    await setDoc(doc(db, 'rooms/roomB'), { orgId: BETA, categoryId: 'catB', name: 'E-120', active: true });
    await setDoc(doc(db, 'roomReservations/resA'), { orgId: ORG, roomId: 'roomA', title: 'Maintenance', start: new Date(), end: new Date() });
    await setDoc(doc(db, 'roomReservations/resB'), { orgId: BETA, roomId: 'roomB', title: 'Maintenance', start: new Date(), end: new Date() });
    await setDoc(doc(db, 'documentLibrary/genA'), { name: 'General A', availability: 'general', kind: 'letter', active: true });
    await setDoc(doc(db, 'documentLibrary/specOrg'), { name: 'Spec ORG', availability: 'specialized', kind: 'letter', orgIds: [ORG], active: true });
    await setDoc(doc(db, 'documentLibrary/specBeta'), { name: 'Spec BETA', availability: 'specialized', kind: 'letter', orgIds: [BETA], active: true });
    // remediations — staff-only (holds injury/assignment details).
    await setDoc(doc(db, 'remediations/remA'), { orgId: ORG, personName: 'Case A', originalClass: 'LE 132', reason: 'injury', blocks: [], status: 'awaiting' });
    await setDoc(doc(db, 'remediations/remB'), { orgId: BETA, personName: 'Case B', originalClass: 'LE 900', reason: 'block_failure', blocks: [], status: 'awaiting' });
  });
});

// Authenticated context — role + tenant claim. orgId defaults to ORG; pass null
// to simulate a token whose orgId claim hasn't propagated yet.
const as = (uid: string, role: string, orgId: string | null = ORG) =>
  testEnv.authenticatedContext(uid, orgId ? { role, orgId } : { role }).firestore();

describe('users — self-edit limits', () => {
  it('instructor CANNOT escalate own role', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { role: 'director' }));
  });
  it('instructor CANNOT set own verifiedQualKeys', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { verifiedQualKeys: ['handgun'] }));
  });
  it('instructor CANNOT change own status', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { status: 'active', verifiedQualKeys: ['x'] }));
  });
  it('instructor CAN edit own profile fields', async () => {
    await assertSucceeds(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { phone: '555-1212', rank: 'Deputy' }));
  });
  it('instructor CAN remove own verified qual, but never add one back', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/vera'), user({ orgId: ORG, verifiedQualKeys: ['general', 'handgun'] }));
    });
    // Removal (subset) is self-service…
    await assertSucceeds(updateDoc(doc(as('vera', 'instructor'), 'users/vera'), { verifiedQualKeys: ['general'] }));
    // …re-adding (superset) still requires staff verification.
    await assertFails(updateDoc(doc(as('vera', 'instructor'), 'users/vera'), { verifiedQualKeys: ['general', 'handgun'] }));
  });
});

describe('users — staff verification (SEC-1)', () => {
  it('coordinator CAN verify ANOTHER user\'s quals', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'users/bob'), { verifiedQualKeys: ['handgun'] }));
  });
  it('coordinator CAN approve another account (status active)', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'users/pat'), { status: 'active' }));
  });
  it('SEC-1: coordinator CANNOT self-grant own verifiedQualKeys', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/carol'), { verifiedQualKeys: ['handgun'] }));
  });
  it('SEC-1: coordinator CANNOT self-change own status', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/carol'), { status: 'inactive' }));
  });
  it('coordinator CANNOT change any role (admin only)', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/bob'), { role: 'sergeant' }));
  });
  it('director CAN change a role', async () => {
    await assertSucceeds(updateDoc(doc(as('dave', 'director'), 'users/bob'), { role: 'sergeant' }));
  });
});

// orgId / platformOwner are server-managed (Admin SDK callables); NO client write
// may set them — else a self-set platformOwner could be minted into a real claim.
describe('users — tenant/platform claims are server-only', () => {
  it('instructor CANNOT self-set platformOwner', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { platformOwner: true }));
  });
  it('instructor CANNOT self-set orgId', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { orgId: 'evil-org' }));
  });
  it('even a director CANNOT change a user platformOwner / orgId', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/bob'), { platformOwner: true }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/bob'), { orgId: 'evil-org' }));
  });
  it('self-registration CANNOT pre-seed platformOwner on create', async () => {
    await assertFails(
      setDoc(doc(as('eve', 'instructor'), 'users/eve'), {
        ...user({ role: 'instructor', status: 'pending' }),
        platformOwner: true,
      })
    );
  });
});

describe('users — reads', () => {
  it('instructor can read own doc, not another\'s', async () => {
    await assertSucceeds(getDoc(doc(as('alice', 'instructor'), 'users/alice')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'users/bob')));
  });
  it('coordinator can read any same-tenant user', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'users/bob')));
  });
});

describe('mail — server-only', () => {
  it('no client (even director) can write mail', async () => {
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'mail/m1'), { to: ['x@y.z'], message: {}, orgId: ORG }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'mail/m2'), { to: ['x@y.z'], message: {}, orgId: ORG }));
  });
  it('non-admin cannot read mail', async () => {
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'mail/m1')));
  });
});

describe('auditLog — owner-attributed create only', () => {
  it('signed-in user CAN create an entry attributed to self', async () => {
    await assertSucceeds(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's', orgId: ORG }));
  });
  it('CANNOT forge another actor\'s entry', async () => {
    await assertFails(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'bob', action: 'x', summary: 's', orgId: ORG }));
  });
  it('non-admin cannot read; cannot delete', async () => {
    let id = '';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const r = await addDoc(collection(ctx.firestore(), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's', orgId: ORG });
      id = r.id;
    });
    await assertFails(getDoc(doc(as('alice', 'instructor'), `auditLog/${id}`)));
    await assertFails(deleteDoc(doc(as('dave', 'director'), `auditLog/${id}`)));
  });
});

describe('sessions/signups/assignments — server-owned sign-up (staff-only client writes)', () => {
  it('non-staff CANNOT create their own signup (sign-up is via the submitSignup callable now)', async () => {
    await assertFails(
      setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/alice'), { uid: 'alice', status: 'confirmed', slotId: 'x', role: 'lead', orgId: ORG })
    );
  });
  it('non-staff CANNOT hand-edit session.roleSlots (over-fill / insert / skip-qual)', async () => {
    await assertFails(
      updateDoc(doc(as('alice', 'instructor'), 'sessions/s1'), { roleSlots: [{ slotId: 'x', role: 'lead', count: 1, filledBy: ['alice'] }], status: 'open' })
    );
  });
  it('non-staff CANNOT forge their own assignment (schedule) entry', async () => {
    await assertFails(
      setDoc(doc(as('alice', 'instructor'), 'assignments/s1_alice'), { uid: 'alice', orgId: ORG, sessionId: 's1', status: 'confirmed' })
    );
  });
  it('staff CAN still write signups + assignments (reserve flow)', async () => {
    await assertSucceeds(
      setDoc(doc(as('carol', 'coordinator'), 'sessions/s1/signups/bob'), { uid: 'bob', status: 'confirmed', slotId: 'x', role: 'lead', orgId: ORG })
    );
    await assertSucceeds(
      setDoc(doc(as('carol', 'coordinator'), 'assignments/s1_bob'), { uid: 'bob', orgId: ORG, sessionId: 's1', status: 'confirmed' })
    );
  });
});

// ── Phase 5: pooled multi-tenant isolation. A caller in tenant ORG must never
// reach tenant BETA's data, and vice-versa. ──
describe('tenant isolation (orgId)', () => {
  it('staff reads OWN tenant academy, NOT another tenant\'s', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'academies/aA')));
    await assertFails(getDoc(doc(as('dave', 'director'), 'academies/aB')));
  });
  it('cannot create an academy stamped with ANOTHER tenant\'s orgId', async () => {
    await assertFails(
      addDoc(collection(as('dave', 'director'), 'academies'), { orgId: BETA, status: 'draft', isTemplate: false, title: 'X' })
    );
    await assertSucceeds(
      addDoc(collection(as('dave', 'director'), 'academies'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'OK' })
    );
  });
  it('cannot create an academy with NO orgId (fails closed)', async () => {
    await assertFails(
      addDoc(collection(as('dave', 'director'), 'academies'), { status: 'draft', isTemplate: false, title: 'X' })
    );
  });
  it('cannot update another tenant\'s academy', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'academies/aB'), { title: 'hijacked' }));
  });
  it('cannot read another tenant\'s session or roster member', async () => {
    await assertFails(getDoc(doc(as('dave', 'director'), 'sessions/sB')));
    await assertFails(getDoc(doc(as('dave', 'director'), 'academies/aB/roster/m1')));
  });
  it('cannot read another tenant\'s settings or user', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'settings/' + ORG)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'settings/' + BETA)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'users/erin')));
  });
  it('admin cannot read another tenant\'s auditLog entry', async () => {
    await assertFails(getDoc(doc(as('dave', 'director'), 'auditLog/lB')));
  });
  it('the BETA director cannot reach ORG data either (symmetry)', async () => {
    await assertFails(getDoc(doc(as('erin', 'director', BETA), 'academies/aA')));
    await assertSucceeds(getDoc(doc(as('erin', 'director', BETA), 'academies/aB')));
  });
  it('a token with NO orgId claim cannot read ANY tenant\'s data', async () => {
    await assertFails(getDoc(doc(as('dave', 'director', null), 'academies/aA')));
    await assertFails(getDoc(doc(as('dave', 'director', null), 'academies/aB')));
  });
  it('orgs: read own org doc + platform-owner; not another tenant\'s', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'orgs/' + ORG)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'orgs/' + BETA)));
    // platform owner reads any org
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'orgs/' + BETA)));
    // even a director cannot client-write an org doc (write:false)
    await assertFails(setDoc(doc(as('dave', 'director'), 'orgs/' + ORG), { orgId: ORG, legalName: 'x' }));
  });

  it('orgs: client (even own-org admin) cannot write compliance/billing fields', async () => {
    // orgs is write:false — DPA + Stripe state is Admin-SDK-only. Guards a future
    // rule loosening from silently letting a tenant forge acceptance / dodge billing.
    await assertFails(updateDoc(doc(as('dave', 'director'), 'orgs/' + ORG), { dpaVersion: 'forged', dpaAcceptedAt: new Date() }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'orgs/' + ORG), { subscriptionStatus: 'active', currentPeriodEnd: 9999999999999 }));
  });

  it('orgId is IMMUTABLE — cannot move an own-tenant doc into another tenant', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'academies/aA'), { orgId: BETA, title: 'x' }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'sessions/s1'), { orgId: BETA }));
  });
  it('cannot CREATE sessions / roster / signups stamped with a FOREIGN orgId', async () => {
    await assertFails(addDoc(collection(as('dave', 'director'), 'sessions'), { academyId: 'aA', status: 'draft', roleSlots: [], start: new Date(), orgId: BETA }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'academies/aA/roster/x'), { fullName: 'Z', status: 'active', orgId: BETA }));
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/alice'), { uid: 'alice', status: 'confirmed', slotId: 'x', role: 'lead', orgId: BETA }));
  });
  it('auditLog: CANNOT create with a foreign or ABSENT orgId', async () => {
    await assertFails(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's', orgId: BETA }));
    await assertFails(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's' }));
  });
  it('an orgless token cannot CREATE even into the right org', async () => {
    await assertFails(addDoc(collection(as('dave', 'director', null), 'academies'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'x' }));
  });
  it('settings: own-org admin writes; NOT another tenant; NOT a non-admin; legacy global not client-readable', async () => {
    await assertSucceeds(setDoc(doc(as('dave', 'director'), 'settings/' + ORG), { orgName: 'PHSC2' }, { merge: true }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'settings/' + BETA), { orgName: 'hijack' }, { merge: true }));
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'settings/' + ORG), { orgName: 'nope' }, { merge: true }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'settings/global'), { orgName: 'old' }); });
    await assertFails(getDoc(doc(as('dave', 'director'), 'settings/global')));
  });
  it('a same-tenant director CAN read a same-tenant user (positive control)', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'users/bob')));
  });
});

// ── Phase 12/13: in-app document builder collection isolation. Staff read their
// own org's documents; only command (admin) may author; orgId is immutable. ──
describe('documentForms — org isolation', () => {
  it('staff reads OWN-tenant document, NOT another tenant\'s', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'documentForms/dfA')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'documentForms/dfB')));
  });
  it('a non-staff instructor cannot read documentForms', async () => {
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'documentForms/dfA')));
  });
  it('admin creates in OWN org; not a foreign org; not orgless', async () => {
    await assertSucceeds(setDoc(doc(as('dave', 'director'), 'documentForms/n1'), { orgId: ORG, name: 'x', active: true }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'documentForms/n2'), { orgId: BETA, name: 'x', active: true }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'documentForms/n3'), { name: 'x', active: true }));
  });
  it('a coordinator (staff, non-admin) cannot create a documentForm', async () => {
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'documentForms/n4'), { orgId: ORG, name: 'x', active: true }));
  });
  it('cannot update another tenant\'s doc; orgId is immutable; own-tenant edit OK', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'documentForms/dfB'), { name: 'hijack' }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'documentForms/dfA'), { orgId: BETA, name: 'x' }));
    await assertSucceeds(updateDoc(doc(as('dave', 'director'), 'documentForms/dfA'), { name: 'ok' }));
  });
  it('admin deletes own-tenant doc, not another tenant\'s', async () => {
    await assertFails(deleteDoc(doc(as('dave', 'director'), 'documentForms/dfB')));
    await assertSucceeds(deleteDoc(doc(as('dave', 'director'), 'documentForms/dfA')));
  });
  it('platform owner acts ONLY within the org their claim points to (no isolation bypass)', async () => {
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'documentForms/dfA')));
    await assertSucceeds(setDoc(doc(owner, 'documentForms/ownNew'), { orgId: ORG, name: 'o', active: true }));
    await assertFails(getDoc(doc(owner, 'documentForms/dfB')));
    await assertFails(deleteDoc(doc(owner, 'documentForms/dfB')));
  });
});

// ── Phase 13 hardening: isolation coverage for the multi-tenant-reworked
// curricula (org-namespaced doc ids) and per-org reportConfig. ──
describe('curricula + reportConfig — org isolation', () => {
  it('reads OWN-tenant curriculum, NOT another tenant\'s (same base key)', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'curricula/' + ORG + '__le_brt')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'curricula/' + BETA + '__le_brt')));
  });
  it('admin creates curricula in OWN org only; orgId immutable', async () => {
    await assertSucceeds(setDoc(doc(as('dave', 'director'), 'curricula/' + ORG + '__co_brt'), { orgId: ORG, key: 'co_brt' }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'curricula/' + BETA + '__x'), { orgId: BETA, key: 'x' }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'curricula/' + ORG + '__le_brt'), { orgId: BETA }));
  });
  it('reportConfig: read + write only the OWN-org doc', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'reportConfig/' + ORG)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'reportConfig/' + BETA)));
    await assertSucceeds(setDoc(doc(as('dave', 'director'), 'reportConfig/' + ORG), { categories: [] }, { merge: true }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'reportConfig/' + BETA), { categories: [] }, { merge: true }));
  });
});

// ── Billing gate: a commercialized org with a lapsed subscription cannot create
// an academy; complimentary + pre-billing orgs always can (mirrors subscription.ts). ──
describe('billing gate — create academy', () => {
  async function setOrgBilling(fields: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgs/' + ORG), { orgId: ORG, legalName: 'PHSC', ...fields }, { merge: true });
    });
  }
  const draft = { orgId: ORG, status: 'draft', isTemplate: false, title: 'X' };
  it('pre-billing org (no billingEnabled) may create', async () => {
    await assertSucceeds(addDoc(collection(as('dave', 'director'), 'academies'), draft));
  });
  it('commercialized + canceled org may NOT create', async () => {
    await setOrgBilling({ billingEnabled: true, subscriptionStatus: 'canceled' });
    await assertFails(addDoc(collection(as('dave', 'director'), 'academies'), draft));
  });
  it('complimentary overrides a lapsed subscription', async () => {
    await setOrgBilling({ billingEnabled: true, subscriptionStatus: 'canceled', complimentary: true });
    await assertSucceeds(addDoc(collection(as('dave', 'director'), 'academies'), draft));
  });
  it('active subscription may create', async () => {
    await setOrgBilling({ billingEnabled: true, subscriptionStatus: 'active' });
    await assertSucceeds(addDoc(collection(as('dave', 'director'), 'academies'), draft));
  });
});

// ── defaultCurricula: the five platform FDLE programs — readable by EVERY signed-in
// user (single source of truth across orgs), writable only by the platform owner. ──
describe('defaultCurricula — platform programs (cross-org read, owner-only write)', () => {
  it('any signed-in user (any tenant) can READ a platform program', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'defaultCurricula/le_brt')));
    await assertSucceeds(getDoc(doc(as('erin', 'instructor', BETA), 'defaultCurricula/le_brt')));
  });
  it('a non-owner (even a director) CANNOT write a platform program', async () => {
    await assertFails(setDoc(doc(as('dave', 'director'), 'defaultCurricula/le_brt'), { key: 'le_brt', label: 'hacked' }, { merge: true }));
  });
  it('the platform owner CAN write a platform program', async () => {
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(setDoc(doc(owner, 'defaultCurricula/le_brt'), { key: 'le_brt', label: 'LE platform', courses: [], totalHours: 770 }, { merge: true }));
  });
});

// ── Room reservation: org-scoped categories + rooms, staff-managed. ──────────
describe('rooms + roomCategories — org isolation (staff-managed)', () => {
  it('reads OWN-org rooms/categories, NOT another tenant\'s', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'rooms/roomA')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'rooms/roomB')));
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'roomCategories/catA')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'roomCategories/catB')));
  });
  it('constrained list returns ONLY this org\'s rooms', async () => {
    const mine = await assertSucceeds(getDocs(query(collection(as('carol', 'coordinator'), 'rooms'), where('orgId', '==', ORG))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id).sort()).toEqual(['roomA']);
  });
  it('staff create/update/delete in OWN org; orgId immutable; not cross-org', async () => {
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'rooms/newA'), { orgId: ORG, categoryId: 'catA', name: 'Range A', active: true }));
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'rooms/newB'), { orgId: BETA, categoryId: 'catB', name: 'X', active: true }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'rooms/roomA'), { orgId: BETA }));
    await assertSucceeds(deleteDoc(doc(as('carol', 'coordinator'), 'rooms/roomA')));
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'roomCategories/catNew'), { orgId: ORG, name: 'Range' }));
  });
  it('instructor CANNOT create rooms or categories', async () => {
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'rooms/nope'), { orgId: ORG, categoryId: 'catA', name: 'X', active: true }));
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'roomCategories/nope'), { orgId: ORG, name: 'X' }));
  });
  it('roomReservations: clients read OWN org only; ALL client writes denied (server-owned)', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'roomReservations/resA')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'roomReservations/resB')));
    // Writes go through the saveRoomReservation/deleteRoomReservation callables — even staff can't write directly.
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'roomReservations/newA'), { orgId: ORG, roomId: 'roomA', title: 'X', start: new Date(), end: new Date() }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'roomReservations/resA'), { title: 'Z' }));
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'roomReservations/nope'), { orgId: ORG, roomId: 'roomA', title: 'X', start: new Date(), end: new Date() }));
  });
});

describe('remediations — staff-only (instructors blocked), org isolation', () => {
  it('instructor CANNOT read remediations, even in their own org', async () => {
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'remediations/remA')));
    await assertFails(getDocs(query(collection(as('alice', 'instructor'), 'remediations'), where('orgId', '==', ORG))));
  });
  it('coordinator reads OWN-org cases, NOT another tenant\'s', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'remediations/remA')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'remediations/remB')));
    const mine = await assertSucceeds(getDocs(query(collection(as('carol', 'coordinator'), 'remediations'), where('orgId', '==', ORG))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual(['remA']);
  });
  it('staff create/update/delete in OWN org; orgId immutable; instructor blocked', async () => {
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'remediations/newA'), { orgId: ORG, personName: 'New', originalClass: 'LE 133', reason: 'block_failure', blocks: [], status: 'awaiting' }));
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'remediations/newB'), { orgId: BETA, personName: 'X', originalClass: 'LE 900', reason: 'injury', blocks: [], status: 'awaiting' }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'remediations/remA'), { orgId: BETA }));
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'remediations/remA'), { notes: 'updated' }));
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'remediations/nope'), { orgId: ORG, personName: 'X', originalClass: 'LE 132', reason: 'injury', blocks: [], status: 'awaiting' }));
    await assertSucceeds(deleteDoc(doc(as('carol', 'coordinator'), 'remediations/newA')));
  });
});

// ── activeStatus: a suspended/inactive token loses staff authority in rules. ──
describe('activeStatus — suspended token blocked', () => {
  it('a staff token carrying status=suspended cannot do staff writes; a normal one can', async () => {
    const suspended = testEnv.authenticatedContext('zz', { role: 'coordinator', orgId: ORG, status: 'suspended' }).firestore();
    await assertFails(setDoc(doc(suspended, 'rooms/zzblocked'), { orgId: ORG, categoryId: 'catA', name: 'X', active: true }));
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'rooms/zzok'), { orgId: ORG, categoryId: 'catA', name: 'OK', active: true }));
  });
});

// ── Academy publish gate: no client self-approval / forged approval. ─────────
describe('academies — publish gate', () => {
  it('staff CANNOT publish an un-approved draft', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aDraft'), { status: 'published' }));
  });
  it('staff CANNOT self-approve by forging approval in the same write', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aDraft'), { status: 'published', approval: { state: 'approved' } }));
  });
  it('clients CANNOT mutate approval at all (only the Admin-SDK callable may)', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'academies/aDraft'), { approval: { state: 'approved' } }));
  });
  it('staff CAN edit benign fields on a draft', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aDraft'), { name: 'Renamed' }));
  });
  it('staff CAN publish once approval.state is approved (set out-of-band by the callable)', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aApproved'), { status: 'published' }));
  });
  it('clients CANNOT create an already-published or pre-approved academy', async () => {
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'academies/forgePub'), { orgId: ORG, status: 'published', isTemplate: false }));
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'academies/forgeApp'), { orgId: ORG, status: 'draft', isTemplate: false, approval: { state: 'approved' } }));
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'academies/okDraft'), { orgId: ORG, status: 'draft', isTemplate: false }));
  });
});

// ── Owner-managed document library: availability-gated, owner-only writes. ──
describe('documentLibrary — availability gating', () => {
  it('staff read GENERAL + own-org SPECIALIZED, NOT another org\'s', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'documentLibrary/genA')));
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'documentLibrary/specOrg')));
    await assertFails(getDoc(doc(as('carol', 'coordinator'), 'documentLibrary/specBeta')));
  });
  it('constrained lists return ONLY this org\'s forms (general + own specialized)', async () => {
    const gen = await assertSucceeds(getDocs(query(collection(as('dave', 'director'), 'documentLibrary'), where('availability', '==', 'general'))));
    expect((gen as { docs: { id: string }[] }).docs.map((d) => d.id).sort()).toEqual(['genA']);
    const mine = await assertSucceeds(getDocs(query(collection(as('dave', 'director'), 'documentLibrary'), where('orgIds', 'array-contains', ORG))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id).sort()).toEqual(['specOrg']);
  });
  it('an UNCONSTRAINED list by staff is denied (another org\'s specialized sibling fails the rule)', async () => {
    await assertFails(getDocs(collection(as('dave', 'director'), 'documentLibrary')));
  });
  it('orgless staff (stale token) read GENERAL only — never a specialized form', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director', null), 'documentLibrary/genA')));
    await assertSucceeds(getDocs(query(collection(as('dave', 'director', null), 'documentLibrary'), where('availability', '==', 'general'))));
    await assertFails(getDoc(doc(as('dave', 'director', null), 'documentLibrary/specOrg')));
  });
  it('a client — even an admin — cannot write the library', async () => {
    await assertFails(setDoc(doc(as('dave', 'director'), 'documentLibrary/x'), { name: 'x', availability: 'general', kind: 'letter', active: true }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'documentLibrary/genA'), { name: 'hijack' }));
    await assertFails(deleteDoc(doc(as('dave', 'director'), 'documentLibrary/genA')));
  });
  it('platform owner reads ALL + writes', async () => {
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'documentLibrary/specBeta')));
    await assertSucceeds(getDocs(collection(owner, 'documentLibrary')));
    await assertSucceeds(setDoc(doc(owner, 'documentLibrary/ownNew'), { name: 'o', availability: 'general', kind: 'letter', active: true }));
    await assertSucceeds(updateDoc(doc(owner, 'documentLibrary/specBeta'), { orgIds: [ORG, BETA] }));
  });
});
