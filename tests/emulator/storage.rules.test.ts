/**
 * Cloud Storage SECURITY RULES tests — run against the Storage emulator:
 *   firebase emulators:exec --only firestore,auth,storage "npm run test:emulator"
 * The CI job currently starts only firestore + auth, so this suite SKIPS itself
 * when no Storage emulator is running (it must never fail the rules deploy gate
 * for a missing emulator). Add `storage` to the job's --only list to enforce it.
 */
import { readFileSync } from 'fs';
import { beforeAll, afterAll, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const hasStorageEmulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const ORG = 'phsc';
const BETA = 'beta';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const png = { contentType: 'image/png' };

let testEnv: RulesTestEnvironment;

describe.skipIf(!hasStorageEmulator)('storage.rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'heimdall-storage-rules-test',
      storage: { rules: readFileSync('storage.rules', 'utf8') },
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const s = ctx.storage();
      await uploadBytes(ref(s, `rooms/${ORG}/plan.png`), PNG, png);
      await uploadBytes(ref(s, `rooms/${BETA}/plan.png`), PNG, png);
      await uploadBytes(ref(s, `certCards/${ORG}/alice/cpr.png`), PNG, png);
      await uploadBytes(ref(s, `branding/${ORG}/logo.png`), PNG, png);
    });
  });
  afterAll(async () => { await testEnv.cleanup(); });

  const as = (uid: string, claims: Record<string, unknown>) => testEnv.authenticatedContext(uid, claims).storage();

  it('member reads OWN-org floor plans, not another tenant\'s; signed-out reads neither', async () => {
    const alice = as('alice', { role: 'instructor', orgId: ORG });
    await assertSucceeds(getBytes(ref(alice, `rooms/${ORG}/plan.png`)));
    await assertFails(getBytes(ref(alice, `rooms/${BETA}/plan.png`)));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), `rooms/${ORG}/plan.png`)));
  });
  it('only staff upload floor plans; only admins upload the logo; logo is public', async () => {
    await assertFails(uploadBytes(ref(as('alice', { role: 'instructor', orgId: ORG }), `rooms/${ORG}/x.png`), PNG, png));
    await assertSucceeds(uploadBytes(ref(as('carol', { role: 'coordinator', orgId: ORG }), `rooms/${ORG}/x.png`), PNG, png));
    await assertFails(uploadBytes(ref(as('carol', { role: 'coordinator', orgId: ORG }), `branding/${ORG}/logo.png`), PNG, png));
    await assertFails(uploadBytes(ref(as('erin', { role: 'director', orgId: BETA }), `branding/${ORG}/logo.png`), PNG, png));
    await assertSucceeds(uploadBytes(ref(as('dave', { role: 'director', orgId: ORG }), `branding/${ORG}/logo.png`), PNG, png));
    await assertSucceeds(getBytes(ref(testEnv.unauthenticatedContext().storage(), `branding/${ORG}/logo.png`)));
  });
  it('a member uploads only their OWN cert card / feedback image, in their OWN org, images only', async () => {
    const alice = as('alice', { role: 'instructor', orgId: ORG });
    await assertSucceeds(uploadBytes(ref(alice, `certCards/${ORG}/alice/new.png`), PNG, png));
    await assertSucceeds(uploadBytes(ref(alice, `feedback/${ORG}/alice/shot.png`), PNG, png));
    await assertFails(uploadBytes(ref(alice, `certCards/${ORG}/bob/new.png`), PNG, png));
    await assertFails(uploadBytes(ref(alice, `certCards/${BETA}/alice/new.png`), PNG, png));
    await assertFails(uploadBytes(ref(alice, `certCards/${ORG}/alice/evil.html`), PNG, { contentType: 'text/html' }));
  });
  it('staff read a member\'s cert card; another instructor cannot', async () => {
    await assertSucceeds(getBytes(ref(as('carol', { role: 'coordinator', orgId: ORG }), `certCards/${ORG}/alice/cpr.png`)));
    await assertFails(getBytes(ref(as('bob', { role: 'instructor', orgId: ORG }), `certCards/${ORG}/alice/cpr.png`)));
    await assertFails(getBytes(ref(as('erin', { role: 'director', orgId: BETA }), `certCards/${ORG}/alice/cpr.png`)));
  });
  it('a read-only Viewer reads no org files and uploads nothing', async () => {
    const viewer = as('vic', { role: 'viewer', orgId: ORG });
    await assertFails(getBytes(ref(viewer, `rooms/${ORG}/plan.png`)));
    await assertFails(getBytes(ref(viewer, `certCards/${ORG}/alice/cpr.png`)));
    await assertFails(uploadBytes(ref(viewer, `certCards/${ORG}/vic/card.png`), PNG, png));
    await assertFails(uploadBytes(ref(viewer, `feedback/${ORG}/vic/shot.png`), PNG, png));
    await assertFails(uploadBytes(ref(viewer, `rooms/${ORG}/x.png`), PNG, png));
    await assertFails(uploadBytes(ref(viewer, `branding/${ORG}/logo.png`), PNG, png));
  });
  // Suspension/deactivation strips the role claim, keeps orgId, mints `status`.
  for (const status of ['suspended', 'inactive', 'pending']) {
    it(`a ${status} member cannot read floor plans or upload anything`, async () => {
      const locked = as('alice', { orgId: ORG, status });
      await assertFails(getBytes(ref(locked, `rooms/${ORG}/plan.png`)));
      await assertFails(uploadBytes(ref(locked, `certCards/${ORG}/alice/new.png`), PNG, png));
      await assertFails(uploadBytes(ref(locked, `feedback/${ORG}/alice/shot.png`), PNG, png));
    });
  }
});
