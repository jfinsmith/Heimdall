/**
 * Firestore SECURITY RULES tests (TEST-1) — run against the emulator:
 *   firebase emulators:exec --only firestore,auth "npm run test:emulator"
 * (needs Java). These assert the RBAC matrix the UI relies on, the SEC-1
 * self-escalation fix, AND Phase-5 multi-tenant isolation (orgId), against the
 * real firestore.rules file.
 */
import { readFileSync } from 'fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection } from 'firebase/firestore';

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
    await setDoc(doc(db, 'academies/aB/roster/m1'), { orgId: BETA, fullName: 'Cadet B', status: 'active' });
    await setDoc(doc(db, 'sessions/sB'), { academyId: 'aB', status: 'open', roleSlots: [], start: new Date(), orgId: BETA });
    await setDoc(doc(db, 'settings/' + BETA), { orgName: 'Beta College' });
    await setDoc(doc(db, 'auditLog/lB'), { actorUid: 'erin', action: 'x', summary: 's', orgId: BETA });
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

describe('signups — ownership + active gate', () => {
  it('active instructor CAN create own signup', async () => {
    await assertSucceeds(
      setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/alice'), { uid: 'alice', status: 'confirmed', slotId: 'x', role: 'lead', orgId: ORG })
    );
  });
  it('CANNOT create another user\'s signup', async () => {
    await assertFails(
      setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/bob'), { uid: 'bob', status: 'confirmed', slotId: 'x', role: 'lead', orgId: ORG })
    );
  });
  it('pending user CANNOT create own signup', async () => {
    await assertFails(
      setDoc(doc(as('pat', 'instructor'), 'sessions/s1/signups/pat'), { uid: 'pat', status: 'confirmed', slotId: 'x', role: 'lead', orgId: ORG })
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
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgs/' + ORG), { orgId: ORG, legalName: 'PHSC' });
      await setDoc(doc(ctx.firestore(), 'orgs/' + BETA), { orgId: BETA, legalName: 'Beta' });
    });
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'orgs/' + ORG)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'orgs/' + BETA)));
    // platform owner reads any org
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'orgs/' + BETA)));
    // even the platform owner / a director cannot client-write an org doc
    await assertFails(setDoc(doc(as('dave', 'director'), 'orgs/' + ORG), { orgId: ORG, legalName: 'x' }));
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
