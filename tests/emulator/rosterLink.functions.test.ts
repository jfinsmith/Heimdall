/**
 * Roster links (import from another class + staying tied) — calls the real
 * handlers in functions/src against the emulators, never production. Skips
 * itself when the emulators are not running.
 */
import { createRequire } from 'module';
import { resolve } from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const hasEmulators = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = 'demo-heimdall-rosterlink'; // demo- can only ever reach the emulators
const ORG = 'phsc';

let db: import('firebase-admin/firestore').Firestore;
let importMembers: { run: (r: unknown) => Promise<unknown> };
let sync: (academyId: string, memberId: string) => Promise<number>;

const staff = (uid = 'carol', orgId = ORG) => ({ uid, token: { role: 'coordinator', orgId } });
const run = (memberIds: string[], over: Record<string, unknown> = {}, auth: unknown = staff()) =>
  importMembers.run({ auth, data: { academyId: 'nmt', sourceAcademyId: 'le', memberIds, ...over } }) as Promise<Record<string, number>>;
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as { code?: string }).code);
const dest = async (id = 'nmt') => (await db.collection(`academies/${id}/roster`).orderBy('no').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
const byName = async (name: string) => (await dest()).filter((m) => m.fullName === name);

describe.skipIf(!hasEmulators)('roster links', () => {
  beforeAll(async () => {
    process.env.GCLOUD_PROJECT = PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT });
    await import('../../functions/src/index');
    const mod = await import('../../functions/src/admin/rosterLink');
    importMembers = mod.rosterImportMembers as never;
    sync = mod.syncLinkedCopies;
    db = createRequire(resolve('functions/package.json'))('firebase-admin/firestore').getFirestore();
  }, 60_000);

  beforeEach(async () => {
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    const w = db.batch();
    const set = (path: string, data: Record<string, unknown>) => w.set(db.doc(path), data);
    set('users/carol', { role: 'coordinator', status: 'active', orgId: ORG, displayName: 'Carol' });
    set('users/alice', { role: 'instructor', status: 'active', orgId: ORG });
    set('users/erin', { role: 'director', status: 'active', orgId: 'beta' });
    set('academies/le', { orgId: ORG, shortName: 'LE 132', name: 'LE 132', status: 'published' });
    set('academies/nmt', { orgId: ORG, shortName: 'NMT 1', name: 'NMT 1', status: 'draft' });
    set('academies/tpl', { orgId: ORG, name: 'T', isTemplate: true });
    set('academies/other', { orgId: 'beta', name: 'Beta class', status: 'published' });
    const m = (no: number, fullName: string, o: Record<string, unknown> = {}) => ({ no, orgId: ORG, fullName, agency: 'PSO', status: 'active', ...o });
    set('academies/le/roster/ann', m(1, 'Ann Active', {
      dob: '2000-01-01', phone: '555', email: 'a@x.y', cjis: 'C1', emergencyName: 'Mom', emergencyPhone: '556',
      grades: { CJK1: { score: 90 } }, violations: [{ level: 'A' }], withdrawnAfterCourse: 'x',
    }));
    set('academies/le/roster/gary', m(2, 'Gary Grad', { status: 'graduated', agency: 'ZPD' }));
    set('academies/le/roster/wes', m(3, 'Wes Withdrawn', { status: 'withdrawn' }));
    set('academies/le/roster/dan', m(4, 'Dan Dismissed', { status: 'dismissed' }));
    set('academies/le/roster/typed', m(5, 'Tina Typed', { phone: '999' }));
    set('academies/nmt/roster/t', m(7, 'tina typed', { phone: '111' })); // typed in by hand earlier
    set('academies/other/roster/x', { no: 1, orgId: 'beta', fullName: 'Beta Cadet', status: 'active' });
    await w.commit();
  }, 30_000);

  it('adds active and graduated cadets; leaves out withdrawn and dismissed; links people already there', async () => {
    const res = await run(['ann', 'gary', 'wes', 'dan', 'typed', 'nobody']);
    expect(res).toMatchObject({ added: 2, linked: 1, alreadyLinked: 0, leftOut: 3 });
    const roster = await dest();
    expect(roster.map((r) => [r.no, r.fullName, r.status])).toEqual([[7, 'tina typed', 'active'], [8, 'Ann Active', 'active'], [9, 'Gary Grad', 'active']]);
    // The hand-typed member keeps what was typed; it only gains the tie.
    expect(roster[0]).toMatchObject({ phone: '111', importedFrom: { academyId: 'le', memberId: 'typed' } });
    expect((await db.doc('academies/nmt').get()).data()).toMatchObject({ rosterSources: ['le'], nextRosterNo: 10 });
  });

  it('copies identity and contact only — never grades, discipline or outcome', async () => {
    await run(['ann']);
    const [ann] = await byName('Ann Active');
    expect(ann).toMatchObject({ dob: '2000-01-01', cjis: 'C1', email: 'a@x.y', emergencyPhone: '556', agency: 'PSO', orgId: ORG });
    for (const k of ['grades', 'violations', 'withdrawnAfterCourse']) expect(ann, k).not.toHaveProperty(k);
  });

  it('importing twice (or at the same moment) never duplicates anyone', async () => {
    await Promise.all([run(['ann', 'gary']), run(['ann', 'gary'])]);
    expect(await run(['ann', 'gary'])).toMatchObject({ added: 0, alreadyLinked: 2 });
    const roster = await dest();
    expect(roster).toHaveLength(3);
    expect(new Set(roster.map((r) => r.no)).size).toBe(3);
  });

  it('refuses non-staff, other organizations, templates, the same class, and bad input — writing nothing', async () => {
    expect(await codeOf(run(['ann'], {}, null))).toBe('unauthenticated');
    expect(await codeOf(run(['ann'], {}, { uid: 'alice', token: { role: 'instructor', orgId: ORG } }))).toBe('permission-denied');
    expect(await codeOf(run(['ann'], {}, staff('erin', 'beta')))).toBe('permission-denied');
    expect(await codeOf(run(['x'], { sourceAcademyId: 'other' }))).toBe('permission-denied');
    expect(await codeOf(run(['ann'], { academyId: 'other' }))).toBe('permission-denied');
    expect(await codeOf(run(['ann'], { sourceAcademyId: 'tpl' }))).toBe('failed-precondition');
    expect(await codeOf(run(['ann'], { sourceAcademyId: 'nmt' }))).toBe('invalid-argument');
    expect(await codeOf(run([]))).toBe('invalid-argument');
    expect(await codeOf(run(['a/b']))).toBe('invalid-argument');
    expect(await dest()).toHaveLength(1);
    expect(await dest('other')).toHaveLength(1);
  });

  it('withdrawing or dismissing the source hides the copy; reinstating brings it back', async () => {
    await run(['ann']);
    for (const status of ['withdrawn', 'dismissed']) {
      await db.doc('academies/le/roster/ann').update({ status });
      expect(await sync('le', 'ann')).toBe(1);
      expect(await sync('le', 'ann')).toBe(0); // repeat delivery is harmless
      expect((await byName('Ann Active'))[0]).toMatchObject({ status: 'withdrawn', sourceSeparated: { status } });
      await db.doc('academies/le/roster/ann').update({ status: 'active' });
      expect(await sync('le', 'ann')).toBe(1);
      const [back] = await byName('Ann Active');
      expect(back.status).toBe('active');
      expect(back).not.toHaveProperty('sourceSeparated');
      expect(back).not.toHaveProperty('withdrawnAt');
    }
  });

  it('keeps an outcome the destination class already recorded', async () => {
    await run(['ann', 'gary']);
    const ann = (await byName('Ann Active'))[0];
    await db.doc(`academies/nmt/roster/${ann.id}`).update({ status: 'graduated' });
    await db.doc('academies/le/roster/ann').update({ status: 'withdrawn' });
    expect(await sync('le', 'ann')).toBe(0);
    expect((await byName('Ann Active'))[0].status).toBe('graduated');
  });

  it('deleting the source member leaves the copy alone', async () => {
    await run(['ann']);
    await db.doc('academies/le/roster/ann').delete();
    expect(await sync('le', 'ann')).toBe(0);
    expect((await byName('Ann Active'))[0].status).toBe('active');
  });

  it('never reaches a class in another organization, or a member tied elsewhere', async () => {
    await db.doc('academies/other').update({ rosterSources: ['le'] });
    await db.doc('academies/other/roster/x').update({ importedFrom: { academyId: 'le', memberId: 'ann' } });
    await db.doc('academies/nmt').update({ rosterSources: ['le'] });
    await db.doc('academies/nmt/roster/t').update({ importedFrom: { academyId: 'co', memberId: 'ann' } });
    await db.doc('academies/le/roster/ann').update({ status: 'withdrawn' });
    expect(await sync('le', 'ann')).toBe(0);
  });
});
