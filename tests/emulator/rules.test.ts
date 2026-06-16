/**
 * Firestore SECURITY RULES tests (TEST-1) — run against the emulator:
 *   firebase emulators:exec --only firestore,auth "npm run test:emulator"
 * (needs Java). These assert the RBAC matrix the UI relies on, including the
 * SEC-1 self-escalation fix, against the real firestore.rules file.
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
  // Seed baseline docs with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), user({ role: 'instructor', status: 'active' }));
    await setDoc(doc(db, 'users/bob'), user({ role: 'instructor', status: 'active' }));
    await setDoc(doc(db, 'users/carol'), user({ role: 'coordinator', status: 'active' }));
    await setDoc(doc(db, 'users/dave'), user({ role: 'director', status: 'active' }));
    await setDoc(doc(db, 'users/pat'), user({ role: 'instructor', status: 'pending' }));
    await setDoc(doc(db, 'sessions/s1'), { academyId: 'a1', status: 'open', roleSlots: [], start: new Date() });
    await setDoc(doc(db, 'sessions/draft'), { academyId: 'a1', status: 'draft', roleSlots: [], start: new Date() });
  });
});

const as = (uid: string, role: string) => testEnv.authenticatedContext(uid, { role }).firestore();

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

describe('users — reads', () => {
  it('instructor can read own doc, not another\'s', async () => {
    await assertSucceeds(getDoc(doc(as('alice', 'instructor'), 'users/alice')));
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'users/bob')));
  });
  it('coordinator can read any user', async () => {
    await assertSucceeds(getDoc(doc(as('carol', 'coordinator'), 'users/bob')));
  });
});

describe('mail — server-only', () => {
  it('no client (even director) can write mail', async () => {
    await assertFails(setDoc(doc(as('alice', 'instructor'), 'mail/m1'), { to: ['x@y.z'], message: {} }));
    await assertFails(setDoc(doc(as('dave', 'director'), 'mail/m2'), { to: ['x@y.z'], message: {} }));
  });
  it('non-admin cannot read mail', async () => {
    await assertFails(getDoc(doc(as('alice', 'instructor'), 'mail/m1')));
  });
});

describe('auditLog — owner-attributed create only', () => {
  it('signed-in user CAN create an entry attributed to self', async () => {
    await assertSucceeds(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's' }));
  });
  it('CANNOT forge another actor\'s entry', async () => {
    await assertFails(addDoc(collection(as('alice', 'instructor'), 'auditLog'), { actorUid: 'bob', action: 'x', summary: 's' }));
  });
  it('non-admin cannot read; cannot delete', async () => {
    let id = '';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const r = await addDoc(collection(ctx.firestore(), 'auditLog'), { actorUid: 'alice', action: 'x', summary: 's' });
      id = r.id;
    });
    await assertFails(getDoc(doc(as('alice', 'instructor'), `auditLog/${id}`)));
    await assertFails(deleteDoc(doc(as('dave', 'director'), `auditLog/${id}`)));
  });
});

describe('signups — ownership + active gate', () => {
  it('active instructor CAN create own signup', async () => {
    await assertSucceeds(
      setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/alice'), { uid: 'alice', status: 'confirmed', slotId: 'x', role: 'lead' })
    );
  });
  it('CANNOT create another user\'s signup', async () => {
    await assertFails(
      setDoc(doc(as('alice', 'instructor'), 'sessions/s1/signups/bob'), { uid: 'bob', status: 'confirmed', slotId: 'x', role: 'lead' })
    );
  });
  it('pending user CANNOT create own signup', async () => {
    await assertFails(
      setDoc(doc(as('pat', 'instructor'), 'sessions/s1/signups/pat'), { uid: 'pat', status: 'confirmed', slotId: 'x', role: 'lead' })
    );
  });
});
