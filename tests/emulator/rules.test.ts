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
import { doc, getDoc, getDocs, query, where, orderBy, limit, setDoc, updateDoc, addDoc, deleteDoc, collection, writeBatch } from 'firebase/firestore';

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
    await setDoc(doc(db, 'auditLog/lA'), { actorUid: 'dave', action: 'x', summary: 's', orgId: ORG });
    await setDoc(doc(db, 'auditLog/lB'), { actorUid: 'erin', action: 'x', summary: 's', orgId: BETA });
    await setDoc(doc(db, 'orgs/' + ORG), { orgId: ORG, legalName: 'PHSC' });
    await setDoc(doc(db, 'orgs/' + BETA), { orgId: BETA, legalName: 'Beta College' });
    // curricula are org-namespaced ({orgId}__{key}); same base key across tenants.
    await setDoc(doc(db, 'curricula/' + ORG + '__le_brt'), { orgId: ORG, key: 'le_brt', label: 'LE' });
    await setDoc(doc(db, 'curricula/' + BETA + '__le_brt'), { orgId: BETA, key: 'le_brt', label: 'LE' });
    // defaultCurricula: the platform FDLE programs (no orgId — shared across orgs).
    await setDoc(doc(db, 'defaultCurricula/le_brt'), { key: 'le_brt', label: 'LE platform', courses: [], totalHours: 770 });
    await setDoc(doc(db, 'reportConfig/' + ORG), { examInfo: {} });
    await setDoc(doc(db, 'reportConfig/' + BETA), { examInfo: {} });
    await setDoc(doc(db, 'roomCategories/catA'), { orgId: ORG, name: 'College' });
    await setDoc(doc(db, 'roomCategories/catB'), { orgId: BETA, name: 'College' });
    await setDoc(doc(db, 'rooms/roomA'), { orgId: ORG, categoryId: 'catA', name: 'E-120', active: true });
    await setDoc(doc(db, 'rooms/roomB'), { orgId: BETA, categoryId: 'catB', name: 'E-120', active: true });
    await setDoc(doc(db, 'roomReservations/resA'), { orgId: ORG, roomId: 'roomA', title: 'Maintenance', start: new Date(), end: new Date() });
    await setDoc(doc(db, 'roomReservations/resB'), { orgId: BETA, roomId: 'roomB', title: 'Maintenance', start: new Date(), end: new Date() });
    // remediations — staff-only (holds injury/assignment details).
    await setDoc(doc(db, 'remediations/remA'), { orgId: ORG, personName: 'Case A', originalClass: 'LE 132', reason: 'injury', blocks: [], status: 'awaiting' });
    await setDoc(doc(db, 'remediations/remB'), { orgId: BETA, personName: 'Case B', originalClass: 'LE 900', reason: 'block_failure', blocks: [], status: 'awaiting' });
    // portal secrets subdoc (staff-only) + a feedback report for the triage-lock suite.
    await setDoc(doc(db, 'academies/acadA/private/portal'), { orgId: ORG, enabled: true, token: 'tok', academicHash: 'h' });
    await setDoc(doc(db, 'feedbackReports/fbA'), { orgId: ORG, kind: 'bug', title: 'T', description: 'D', severity: 'low', submittedByUid: 'alice', submittedByName: 'Alice', status: 'new' });
  });
});

// Authenticated context — role + tenant claim. orgId defaults to ORG; pass null
// to simulate a token whose orgId claim hasn't propagated yet.
const as = (uid: string, role: string, orgId: string | null = ORG) =>
  testEnv.authenticatedContext(uid, orgId ? { role, orgId } : { role }).firestore();
// A brand-new sign-in: no role/org claims yet, only the identity's email (the
// users create rule pins the profile email to it).
const asNew = (uid: string, email = 'eve@x.y') => testEnv.authenticatedContext(uid, { email }).firestore();

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
  it('even a director CANNOT self-grant own verifiedQualKeys (admin branch)', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/dave'), { verifiedQualKeys: ['handgun'] }));
  });
  it('a director CAN still edit own profile fields', async () => {
    await assertSucceeds(updateDoc(doc(as('dave', 'director'), 'users/dave'), { phone: '555-0100' }));
  });
  it('SEC-1: coordinator CANNOT self-grant own verifiedQualKeys', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/carol'), { verifiedQualKeys: ['handgun'] }));
  });
  it('SEC-1: coordinator CANNOT self-change own status', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/carol'), { status: 'inactive' }));
  });
  it('coordinator CANNOT change any role (callable only)', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'users/bob'), { role: 'sergeant' }));
  });
  it('even a director CANNOT write a role directly — setUserRole is the only path', async () => {
    // A direct role write skipped the rank-ladder check in the callable: a
    // sergeant could write an accomplice up to director.
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/bob'), { role: 'sergeant' }));
  });
  it('even a director CANNOT rewrite another member\'s sign-in email (mail-redirect)', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/bob'), { email: 'attacker@evil.test' }));
  });
  it('even a director CANNOT suspend via direct doc write — setUserSuspension only', async () => {
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/bob'), { status: 'suspended' }));
  });
  it('status can only move pending → active (no direct un-suspend)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/sam'), user({ orgId: ORG, status: 'suspended' }));
    });
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/sam'), { status: 'active' }));
  });
  it('NO client may delete a user doc — adoption-hijack guard', async () => {
    await assertFails(deleteDoc(doc(as('dave', 'director'), 'users/bob')));
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
  it('self-registration CANNOT pre-seed homeOrgId / homeRole (owner-switch anchors)', async () => {
    await assertFails(
      setDoc(doc(asNew('eve'), 'users/eve'), { ...user({ role: 'instructor', status: 'pending', email: 'eve@x.y' }), homeOrgId: ORG, homeRole: 'director' })
    );
  });
});

// A self-registered profile is created by the user themselves — the ONLY
// client write that can set `email` (immutable afterwards). It must be the
// signed-in identity's address, or a verified Gmail login could pose as
// someone@tenant.edu to the domain auto-join trigger and to approving admins.
describe('users — self-registration create', () => {
  const fresh = (over: Record<string, unknown> = {}) => user({ role: 'instructor', status: 'pending', email: 'eve@x.y', ...over });
  it('CAN create own pending profile with the token email (positive control)', async () => {
    await assertSucceeds(setDoc(doc(asNew('eve'), 'users/eve'), fresh()));
  });
  it('CANNOT create a profile whose email differs from the signed-in identity', async () => {
    await assertFails(setDoc(doc(asNew('eve'), 'users/eve'), fresh({ email: 'director@tenant.edu' })));
  });
  it('CANNOT create a profile when the token carries no email', async () => {
    await assertFails(setDoc(doc(as('eve', 'instructor'), 'users/eve'), fresh()));
  });
  it('an email-less token CAN create only an EMPTY-email profile (never a chosen one)', async () => {
    await assertSucceeds(setDoc(doc(as('eve', 'instructor'), 'users/eve'), fresh({ email: '' })));
  });
  it('CANNOT pre-seed a verified notification email on create', async () => {
    await assertFails(setDoc(doc(asNew('eve'), 'users/eve'), fresh({ notificationEmail: 'attacker@evil.test', notificationEmailVerified: true })));
    await assertFails(setDoc(doc(asNew('eve'), 'users/eve'), fresh({ notificationEmailPending: 'attacker@evil.test' })));
  });
  it('CANNOT create as anything but a pending instructor', async () => {
    await assertFails(setDoc(doc(asNew('eve'), 'users/eve'), fresh({ role: 'director' })));
    await assertFails(setDoc(doc(asNew('eve'), 'users/eve'), fresh({ status: 'active' })));
  });
});

// The notification-email fields are written ONLY by the code-verified callables
// (Admin SDK) — a client write could forge notificationEmailVerified and route
// mail to an inbox the member never proved they control.
describe('users — notification email is callable-only', () => {
  it('instructor CANNOT self-set a verified notification email', async () => {
    await assertFails(
      updateDoc(doc(as('alice', 'instructor'), 'users/alice'), {
        notificationEmail: 'attacker@evil.test',
        notificationEmailVerified: true,
      })
    );
  });
  it('instructor CANNOT self-set the pending address either', async () => {
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice'), { notificationEmailPending: 'x@y.test' }));
  });
  it('even a director CANNOT write another member\'s notification email', async () => {
    await assertFails(
      updateDoc(doc(as('dave', 'director'), 'users/bob'), { notificationEmail: 'x@y.test', notificationEmailVerified: true })
    );
  });
  it('documentAssignments: staff read, ONLY the platform owner writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documentAssignments/exam_rules'), { scope: 'orgs', orgIds: [ORG] });
    });
    // Staff (who print documents) read the org-scoping map; plain members have
    // no use for the platform's tenant roster and cannot read it.
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'documentAssignments/exam_rules')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'documentAssignments/exam_rules')));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'documentAssignments/exam_rules'), { scope: 'all' }));
    const owner = testEnv.authenticatedContext('owner1', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(updateDoc(doc(owner, 'documentAssignments/exam_rules'), { scope: 'all' }));
  });
  it('no client can read or write users/{uid}/private (the code hash lives there)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice/private/notificationEmail'), { emailLower: 'a@b.c', codeHash: 'h' });
    });
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'users/alice/private/notificationEmail')));
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'users/alice/private/notificationEmail'), { codeHash: 'forged' }));
    await assertFails(getDoc(doc(as('dave', 'director'), 'users/alice/private/notificationEmail')));
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

describe('auditLog — owner-attributed create only', () => {
  it('staff CAN create an entry attributed to self', async () => {
    await assertSucceeds(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's', orgId: ORG }));
  });
  it('CANNOT forge another actor\'s entry', async () => {
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'bob', action: 'x', summary: 's', orgId: ORG }));
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
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's', orgId: BETA }));
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's' }));
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
  it('a NOT-YET-CREATED curriculum doc may be subscribed to (useCurriculum org-copy listener); lists stay org-scoped', async () => {
    await assertSucceeds(getDoc(doc(as('alice', 'instructor'), 'curricula/' + ORG + '__nonexistent')));
    const mine = await assertSucceeds(getDocs(query(collection(as('carol', 'coordinator'), 'curricula'), where('orgId', '==', ORG))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual([ORG + '__le_brt']);
    await assertFails(getDocs(collection(as('carol', 'coordinator'), 'curricula')));
  });
  it('reportConfig: read + write only the OWN-org doc', async () => {
    await assertSucceeds(getDoc(doc(as('dave', 'director'), 'reportConfig/' + ORG)));
    await assertFails(getDoc(doc(as('dave', 'director'), 'reportConfig/' + BETA)));
    await assertSucceeds(setDoc(doc(as('dave', 'director'), 'reportConfig/' + ORG), { examInfo: {} }, { merge: true }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'reportConfig/' + BETA), { examInfo: {} }, { merge: true }));
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

describe('security-audit hardening (sergeant tier, portal secrets, feedback triage)', () => {
  it('portal secrets subdoc: staff read OK, instructor DENIED', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'academies/acadA/private/portal')));
    // Limbo activities live on the org settings doc: staff may edit THAT field only.
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'settings/' + ORG), { limboActivities: ['Range', 'SOCE'], limboActivityColors: { Range: 'amber' } }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'settings/' + ORG), { limboActivities: ['Range'], orgName: 'Hijacked' }));
    await assertFails(updateDoc(doc(as('alice', 'instructor'), 'settings/' + ORG), { limboActivities: ['Range'] }));
    await assertFails(updateDoc(doc(as('erin', 'director', BETA), 'settings/' + ORG), { limboActivities: ['Range'] }));
    // Limbo plan: staff may subscribe before the first save, create with their org, never cross-org; instructors denied.
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'academies/aA/limbo/plan')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'academies/aA/limbo/plan')));
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'academies/aA/limbo/plan'), { orgId: ORG, academyId: 'aA', cells: {} }));
    await assertFails(setDoc(doc(as('erin', 'director', BETA), 'academies/aA/limbo/plan'), { orgId: BETA, academyId: 'aA', nmtStart: '2027-01-04' }, { merge: true }));
    await assertFails(getDoc(doc(as('erin', 'director', BETA), 'academies/aA/limbo/plan')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'academies/acadA/private/portal')));
    // Staff may read a NOT-YET-CREATED private doc (the builder subscribes to
    // private/portal before the link exists — a denial kills the listener and
    // the card never updates after Create); non-staff stay denied either way.
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'academies/acadA/private/nonexistent')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'academies/acadA/private/nonexistent')));
  });
  it('admin cannot CHANGE their OWN role field on the user doc', async () => {
    // Writing a DIFFERENT role for yourself is blocked (self-escalation path);
    // re-writing the same value is a no-op and passes unchanged().
    await assertFails(updateDoc(doc(as('dave', 'director'), 'users/dave'), { role: 'lieutenant' }));
    // Editing own NON-role fields still fine.
    await assertSucceeds(updateDoc(doc(as('dave', 'director'), 'users/dave'), { rank: 'Cpt.' }));
  });
  it('feedbackReports: client admin may write triage notes but NOT status/orgId', async () => {
    await assertSucceeds(updateDoc(doc(as('dave', 'director'), 'feedbackReports/fbA'), { adminNotes: 'looking' }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'feedbackReports/fbA'), { status: 'resolved' }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'feedbackReports/fbA'), { orgId: BETA }));
  });
  it('auditLog: org admin can no longer read (owner-only)', async () => {
    await assertFails(getDoc(doc(as('dave', 'director'), 'auditLog/lA')));
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

// scheduleChangeQueue — server-owned; staff read their own org's pending notices.
describe('scheduleChangeQueue — staff read, no client writes, org-isolated', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'scheduleChangeQueue/s1'), { orgId: ORG, academyId: 'aA', sessionId: 's1', notifyAfter: new Date(), firstChangedAt: new Date(), lastChangedAt: new Date(), before: {} });
    });
  });
  it('coordinator CAN read + list own org entries by academy', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'scheduleChangeQueue/s1')));
    await assertSucceeds(getDocs(query(collection(as('carol', 'coordinator'), 'scheduleChangeQueue'), where('orgId', '==', ORG), where('academyId', '==', 'aA'))));
  });
  it('instructor CANNOT read; other org CANNOT read; nobody writes', async () => {
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'scheduleChangeQueue/s1')));
    await assertFails(getDoc(doc(as('erin', 'director', BETA), 'scheduleChangeQueue/s1')));
    await assertFails(deleteDoc(doc(as('dave', 'director'), 'scheduleChangeQueue/s1')));
    await assertFails(setDoc(doc(as('dave', 'director'), 'scheduleChangeQueue/s2'), { orgId: ORG, academyId: 'aA', sessionId: 's2' }));
  });
});

// ── Polish sweep (Nov 2026) ─────────────────────────────────────────────────

// Queued mail bodies carry temporary passwords (createUserAccount /
// createOrgAdmin / sendActivationEmail) and notification-email verification
// codes, kept 30 days. No client surface reads the queue, so reads are
// closed outright — a same-org sergeant could otherwise lift a new director's
// temp password and sign in as them before they do (rank-ladder bypass).
describe('mailQueue — no client reads (bodies carry temp passwords / codes)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const msg = { subject: 's', html: 'Temporary password: Heimdall-deadbeef', text: 't' };
      await setDoc(doc(db, 'mailQueue/mq1'), { orgId: ORG, to: ['new.director@x.y'], message: msg });
    });
  });
  it('even a same-org director/sergeant CANNOT get or list queued mail', async () => {
    for (const [uid, role] of [['dave', 'director'], ['sgt', 'sergeant']] as const) {
      await assertFails(getDoc(doc(as(uid, role), 'mailQueue/mq1')));
      await assertFails(getDocs(query(collection(as(uid, role), 'mailQueue'), where('orgId', '==', ORG))));
    }
  });
  it('the platform owner cannot read it from a client either', async () => {
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertFails(getDoc(doc(owner, 'mailQueue/mq1')));
  });
});

// isTemplate exempts a class from the captain's-approval publish gate, so it
// must be fixed at create. Otherwise: mark a pending draft as a template,
// publish it (exempt), then clear the flag — a live class nobody approved.
describe('academies — isTemplate is immutable (approval-gate bypass)', () => {
  it('staff CANNOT turn an un-approved draft into a template to publish it', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aDraft'), { isTemplate: true }));
    await assertFails(updateDoc(doc(as('dave', 'director'), 'academies/aDraft'), { isTemplate: true, status: 'draft' }));
  });
  it('a real template still publishes without approval, but can never become a real class', async () => {
    await assertSucceeds(setDoc(doc(as('carol', 'coordinator'), 'academies/aTpl'), { orgId: ORG, status: 'draft', isTemplate: true, title: 'Tpl' }));
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aTpl'), { status: 'published' }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aTpl'), { isTemplate: false }));
  });
  it('edits that leave isTemplate alone (or re-send the same value) still pass', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aDraft'), { name: 'Renamed', isTemplate: false }));
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aA'), { signupsEnabled: false }));
  });
});

// Same gate, session side: a session may be created already-visible under a
// template; re-pointing it at an un-approved class would surface it there.
describe('sessions — academyId is immutable', () => {
  it('staff CANNOT move a session to another academy', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'sessions/s1'), { academyId: 'aDraft' }));
  });
  it('an edit that re-sends the same academyId (every form does) still passes', async () => {
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'sessions/s1'), { academyId: 'a1', title: 'Edited' }));
  });
});

// A suspended / deactivated member's role claim is stripped and a status claim
// minted, but the Auth login is not disabled — they can sign in again and hold a
// token with their orgId. Member-level reads must not survive that.
// 'pending' is the same gate for a NOT-YET-APPROVED joiner: the join callables
// mint it with the orgId claim, and approval (setUserRole) drops it.
describe('activeStatus — a suspended/inactive/pending member loses ORG reads, not just staff writes', () => {
  const locked = (status: string) => testEnv.authenticatedContext('alice', { orgId: ORG, status }).firestore();
  for (const status of ['suspended', 'inactive', 'pending']) {
    it(`${status}: no schedule, rooms, settings or org reads; no feedback/audit writes`, async () => {
      const db = locked(status);
      await assertFails(getDoc(doc(db, 'academies/aA')));
      await assertFails(getDoc(doc(db, 'sessions/s1')));
      await assertFails(getDocs(query(collection(db, 'sessions'), where('orgId', '==', ORG), where('status', '==', 'open'))));
      await assertFails(getDoc(doc(db, 'rooms/roomA')));
      await assertFails(getDoc(doc(db, 'roomReservations/resA')));
      await assertFails(getDoc(doc(db, 'curricula/' + ORG + '__le_brt')));
      await assertFails(getDoc(doc(db, 'settings/' + ORG)));
      await assertFails(getDoc(doc(db, 'reportConfig/' + ORG)));
      await assertFails(getDoc(doc(db, 'orgs/' + ORG)));
      await assertFails(addDoc(collection(db, 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's', orgId: ORG }));
      await assertFails(addDoc(collection(db, 'feedbackReports'), { orgId: ORG, kind: 'bug', title: 'T', description: 'D', submittedByUid: 'alice', status: 'new' }));
    });
    it(`${status}: still reads their OWN profile (the sign-in page shows the suspended/deactivated notice from it)`, async () => {
      await assertSucceeds(getDoc(doc(locked(status), 'users/alice')));
    });
  }
  it('pending: can still finish their own profile (date of birth) while awaiting approval', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/pat'), user({ orgId: ORG, status: 'pending' }));
    });
    const pat = testEnv.authenticatedContext('pat', { orgId: ORG, status: 'pending' }).firestore();
    await assertSucceeds(updateDoc(doc(pat, 'users/pat'), { dob: '1990-01-01' }));
    // …but cannot approve themselves.
    await assertFails(updateDoc(doc(pat, 'users/pat'), { status: 'active' }));
  });
  it('once approved (role + orgId, no status claim) the same account reads the org', async () => {
    const pat = testEnv.authenticatedContext('pat', { orgId: ORG, role: 'instructor' }).firestore();
    await assertSucceeds(getDoc(doc(pat, 'settings/' + ORG)));
    await assertSucceeds(getDoc(doc(pat, 'sessions/s1')));
  });
  it('an ACTIVE instructor keeps every one of those reads (positive control)', async () => {
    const db = as('alice', 'instructor');
    await assertSucceeds(getDoc(doc(db, 'academies/aA')));
    await assertSucceeds(getDoc(doc(db, 'sessions/s1')));
    await assertSucceeds(getDoc(doc(db, 'rooms/roomA')));
    await assertSucceeds(getDoc(doc(db, 'roomReservations/resA')));
    await assertSucceeds(getDoc(doc(db, 'settings/' + ORG)));
    await assertSucceeds(getDoc(doc(db, 'reportConfig/' + ORG)));
    await assertSucceeds(getDoc(doc(db, 'orgs/' + ORG)));
  });
});

// The LIST queries the app actually runs for a plain instructor / staff / the
// owner. A legitimate query the rules deny is a live bug (blank page), so each
// shape is pinned here exactly as the client builds it (useCollection injects
// the orgId filter first).
describe('client query shapes — the lists the app runs are allowed', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'assignments/s1_alice'), { orgId: ORG, uid: 'alice', sessionId: 's1', academyId: 'aA', status: 'confirmed', start: new Date(), end: new Date() });
      await setDoc(doc(db, 'assignments/s1_bob'), { orgId: ORG, uid: 'bob', sessionId: 's1', academyId: 'aA', status: 'confirmed', start: new Date(), end: new Date() });
      await setDoc(doc(db, 'sessions/s1/signups/alice'), { orgId: ORG, uid: 'alice', status: 'confirmed', slotId: 'x', role: 'lead' });
      await setDoc(doc(db, 'notifications/n1'), { uid: 'alice', title: 't', read: false, createdAt: new Date() });
      await setDoc(doc(db, 'notifications/n2'), { uid: 'bob', title: 't', read: false, createdAt: new Date() });
    });
  });
  it('instructor: published academies (status in …) — and the unconstrained list is denied', async () => {
    const db = as('alice', 'instructor');
    const got = await assertSucceeds(getDocs(query(collection(db, 'academies'), where('orgId', '==', ORG), where('status', 'in', ['published', 'in_progress', 'completed']))));
    expect((got as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual(['aA']);
    await assertFails(getDocs(query(collection(db, 'academies'), where('orgId', '==', ORG))));
  });
  it('instructor: open sessions from now, ordered by start', async () => {
    const db = as('alice', 'instructor');
    await assertSucceeds(getDocs(query(collection(db, 'sessions'), where('orgId', '==', ORG), where('status', '==', 'open'), where('start', '>=', new Date(0)), orderBy('start'))));
    // …but not "every session in the org" (drafts must stay hidden).
    await assertFails(getDocs(query(collection(db, 'sessions'), where('orgId', '==', ORG))));
  });
  it('instructor: OWN confirmed assignments only', async () => {
    const db = as('alice', 'instructor');
    const mine = await assertSucceeds(getDocs(query(collection(db, 'assignments'), where('orgId', '==', ORG), where('uid', '==', 'alice'), where('status', '==', 'confirmed'), orderBy('start'))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual(['s1_alice']);
    await assertFails(getDocs(query(collection(db, 'assignments'), where('orgId', '==', ORG), where('status', '==', 'confirmed'))));
  });
  it('instructor: a session\'s sign-ups, own feedback reports, own notifications', async () => {
    const db = as('alice', 'instructor');
    await assertSucceeds(getDocs(query(collection(db, 'sessions/s1/signups'), where('orgId', '==', ORG), where('status', 'in', ['confirmed', 'waitlist']))));
    await assertSucceeds(getDocs(query(collection(db, 'feedbackReports'), where('orgId', '==', ORG), where('submittedByUid', '==', 'alice'))));
    const mine = await assertSucceeds(getDocs(query(collection(db, 'notifications'), where('uid', '==', 'alice'), orderBy('createdAt', 'desc'), limit(20))));
    expect((mine as { docs: { id: string }[] }).docs.map((d) => d.id)).toEqual(['n1']);
    await assertFails(getDocs(query(collection(db, 'notifications'), where('uid', '==', 'bob'))));
  });
  it('staff: org users (by name / role / status), all org sessions, confirmed assignments', async () => {
    const db = as('carol', 'coordinator');
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG), orderBy('displayName'), limit(2000))));
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG), where('role', 'in', ['director', 'lieutenant']), where('status', '==', 'active'))));
    await assertSucceeds(getDocs(query(collection(db, 'sessions'), where('orgId', '==', ORG), where('academyId', '==', 'a1'), orderBy('start'))));
    await assertSucceeds(getDocs(query(collection(db, 'assignments'), where('orgId', '==', ORG), where('status', '==', 'confirmed'))));
    await assertSucceeds(getDocs(query(collection(db, 'academies'), where('orgId', '==', ORG), orderBy('startDate', 'desc'))));
    // An instructor may not enumerate the org's users.
    await assertFails(getDocs(query(collection(as('alice', 'instructor'), 'users'), where('orgId', '==', ORG))));
  });
  it('owner: the org-scoped audit list; feedback triage list for an admin', async () => {
    const owner = testEnv.authenticatedContext('owner', { role: 'director', orgId: ORG, platformOwner: true }).firestore();
    await assertSucceeds(getDocs(query(collection(owner, 'auditLog'), where('orgId', '==', ORG), orderBy('createdAt', 'desc'), limit(200))));
    await assertSucceeds(getDocs(query(collection(as('dave', 'director'), 'feedbackReports'), where('orgId', '==', ORG), orderBy('createdAt', 'desc'))));
  });
});

// A subdocument's own orgId stamp is caller-supplied, so by itself it proves
// nothing about the PARENT. Without a parent check, staff of one tenant could
// plant docs under another tenant's academy: a private/portal doc carrying
// their own token + password (the public-portal callable trusts that doc, so it
// would serve the other tenant's roster and grades to anyone), fake roster
// rows, or a squatted attendance / limbo doc the real owner can then never save.
describe('cross-tenant parent binding — academy subcollections + session.academyId', () => {
  const erin = () => as('erin', 'director', BETA);
  it('another tenant\'s staff CANNOT create subdocs under OUR academy, even stamped with their own org', async () => {
    await assertFails(setDoc(doc(erin(), 'academies/aA/private/portal'), { orgId: BETA, enabled: true, token: 'theirs', academicHash: 'h' }));
    await assertFails(setDoc(doc(erin(), 'academies/aA/roster/fake'), { orgId: BETA, fullName: 'Planted Cadet', status: 'active' }));
    await assertFails(setDoc(doc(erin(), 'academies/aA/attendance/2026-11-10'), { orgId: BETA, date: '2026-11-10', entries: {} }));
    await assertFails(setDoc(doc(erin(), 'academies/aA/limbo/squat'), { orgId: BETA, academyId: 'aA', cells: {} }));
    await assertFails(addDoc(collection(erin(), 'academies/aA/reports'), { orgId: BETA, type: 'general_memo', cadetName: 'X' }));
  });
  it('our own staff still create every one of them under OUR academy', async () => {
    const db = as('carol', 'coordinator');
    await assertSucceeds(setDoc(doc(db, 'academies/aA/private/portal'), { orgId: ORG, enabled: true, token: 'ours', academicHash: 'h' }));
    await assertSucceeds(setDoc(doc(db, 'academies/aA/roster/c1'), { orgId: ORG, fullName: 'Cadet One', status: 'active' }));
    await assertSucceeds(setDoc(doc(db, 'academies/aA/attendance/2026-11-10'), { orgId: ORG, date: '2026-11-10', entries: {} }));
    await assertSucceeds(setDoc(doc(db, 'academies/aA/limbo/plan'), { orgId: ORG, academyId: 'aA', cells: {} }));
    await assertSucceeds(addDoc(collection(db, 'academies/aA/reports'), { orgId: ORG, type: 'general_memo', cadetName: 'X' }));
    // …and keep editing them afterwards (update needs no parent read).
    await assertSucceeds(setDoc(doc(db, 'academies/aA/limbo/plan'), { nmtStart: '2027-01-04' }, { merge: true }));
    await assertSucceeds(updateDoc(doc(db, 'academies/aA/roster/c1'), { status: 'withdrawn' }));
  });
  it('no subdoc can be created under an academy that does not exist', async () => {
    await assertFails(setDoc(doc(as('carol', 'coordinator'), 'academies/ghost/roster/c1'), { orgId: ORG, fullName: 'X', status: 'active' }));
  });
  it('a session cannot be created against ANOTHER tenant\'s academy (it would show on their public class page)', async () => {
    const base = { roleSlots: [], start: new Date(), end: new Date(), orgId: BETA };
    // aApproved is ORG's approved class — exactly the case the publish gate alone let through.
    await assertFails(addDoc(collection(erin(), 'sessions'), { ...base, academyId: 'aApproved', status: 'open' }));
    await assertFails(addDoc(collection(erin(), 'sessions'), { ...base, academyId: 'aA', status: 'draft' }));
    await assertFails(addDoc(collection(erin(), 'sessions'), { ...base, academyId: 'ghost', status: 'draft' }));
  });
  it('the app\'s BULK shapes still commit: 300 sessions in one batch under one academy (recurring generator / clone)', async () => {
    // Each write reads the SAME academy doc, which rules cache per request — the
    // 20-access-call batch limit only bites on distinct documents.
    const db = as('carol', 'coordinator');
    for (const [academyId, status] of [['aDraft', 'draft'], ['aApproved', 'scheduled']] as const) {
      const batch = writeBatch(db);
      for (let i = 0; i < 300; i++) {
        batch.set(doc(collection(db, 'sessions')), { orgId: ORG, academyId, status, roleSlots: [], start: new Date(), end: new Date() });
      }
      await assertSucceeds(batch.commit());
    }
  });
  it('our own staff still create draft sessions anywhere and visible ones under an approved class', async () => {
    const db = as('carol', 'coordinator');
    const base = { roleSlots: [], start: new Date(), end: new Date(), orgId: ORG };
    await assertSucceeds(addDoc(collection(db, 'sessions'), { ...base, academyId: 'aDraft', status: 'draft' }));
    await assertSucceeds(addDoc(collection(db, 'sessions'), { ...base, academyId: 'aApproved', status: 'scheduled' }));
    await assertFails(addDoc(collection(db, 'sessions'), { ...base, academyId: 'aDraft', status: 'open' }));
  });
});

// Deleting a class cascades its sessions, roster and records, so it is limited
// to command (sergeant+) and the coordinator who created that class.
describe('academies — delete is sergeant+ or the creating coordinator', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'academies/aMine'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'Mine', createdBy: 'carol' });
      await setDoc(doc(db, 'academies/aTheirs'), { orgId: ORG, status: 'published', isTemplate: false, title: 'Theirs', createdBy: 'someone-else' });
      await setDoc(doc(db, 'academies/aLegacy'), { orgId: ORG, status: 'draft', isTemplate: false, title: 'No creator on file' });
    });
  });
  it('a coordinator deletes a class they created', async () => {
    await assertSucceeds(deleteDoc(doc(as('carol', 'coordinator'), 'academies/aMine')));
  });
  it("a coordinator CANNOT delete a colleague's class, nor one with no creator on file", async () => {
    await assertFails(deleteDoc(doc(as('carol', 'coordinator'), 'academies/aTheirs')));
    await assertFails(deleteDoc(doc(as('carol', 'coordinator'), 'academies/aLegacy')));
  });
  it('a coordinator cannot claim a class by rewriting createdBy, then delete it', async () => {
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aTheirs'), { createdBy: 'carol' }));
    await assertFails(updateDoc(doc(as('carol', 'coordinator'), 'academies/aLegacy'), { createdBy: 'carol' }));
    // …while ordinary edits to someone else's class still work.
    await assertSucceeds(updateDoc(doc(as('carol', 'coordinator'), 'academies/aTheirs'), { title: 'Renamed' }));
  });
  it('sergeant, lieutenant and director delete any class in their org', async () => {
    await assertSucceeds(deleteDoc(doc(as('sam', 'sergeant'), 'academies/aTheirs')));
    await assertSucceeds(deleteDoc(doc(as('lee', 'lieutenant'), 'academies/aLegacy')));
    await assertSucceeds(deleteDoc(doc(as('dave', 'director'), 'academies/aMine')));
  });
  it('nobody deletes across tenants; instructors and locked-out staff never delete', async () => {
    await assertFails(deleteDoc(doc(as('erin', 'director', BETA), 'academies/aMine')));
    await assertFails(deleteDoc(doc(as('alice', 'instructor'), 'academies/aMine')));
    const suspendedCreator = testEnv.authenticatedContext('carol', { orgId: ORG, status: 'suspended' }).firestore();
    await assertFails(deleteDoc(doc(suspendedCreator, 'academies/aMine')));
  });
});

// Every client logAudit() call site is a staff surface; members' own actions
// (sign-up, withdraw) are logged server-side by the callables.
describe('auditLog — staff-only create', () => {
  it('a plain member (or a not-yet-approved join) CANNOT append audit entries', async () => {
    await assertFails(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'alice', action: 'user.approve', summary: 'forged', orgId: ORG }));
    const pending = testEnv.authenticatedContext('pat', { orgId: ORG }).firestore();
    await assertFails(addDoc(collection(pending, 'auditLog'), { actorUid: 'pat', action: 'x', summary: 's', orgId: ORG }));
  });
  it('staff still log their own actions, in their own org only', async () => {
    await assertSucceeds(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's', orgId: ORG }));
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'dave', action: 'x', summary: 's', orgId: ORG }));
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's', orgId: BETA }));
    await assertFails(addDoc(collection(as('carol', 'coordinator'), 'auditLog'), { actorUid: 'carol', action: 'x', summary: 's' }));
  });
});
