/**
 * Signup-concurrency test (TEST-2) — run against the emulator:
 *   firebase emulators:exec --only firestore,auth "npm run test:emulator"
 *
 * Proves the core invariant: when two instructors race for the LAST slot, the
 * transactional capacity check serializes them and exactly ONE wins. This
 * mirrors the critical section of src/features/sessions/useSignup.ts
 * (read slot -> reject if filledBy.length >= count -> append uid) so a
 * regression in that pattern would fail here.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, type Firestore } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: 'heimdall-concurrency-test' });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

/** Mirror of useSignup.ts's transaction critical section (capacity-gated append). */
function trySignup(db: Firestore, sessionId: string, slotId: string, uid: string) {
  const ref = doc(db, 'sessions', sessionId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const session = snap.data() as { roleSlots: { slotId: string; count: number; filledBy: string[] }[] };
    const slot = session.roleSlots.find((s) => s.slotId === slotId);
    if (!slot) throw new Error('NO_SLOT');
    if (slot.filledBy.includes(uid)) return 'already';
    if (slot.filledBy.length >= slot.count) throw new Error('FULL');
    const newSlots = session.roleSlots.map((s) => (s.slotId === slotId ? { ...s, filledBy: [...s.filledBy, uid] } : s));
    tx.update(ref, { roleSlots: newSlots });
    return 'confirmed';
  });
}

describe('signup concurrency', () => {
  it('two instructors racing the last 1-count slot — exactly one wins', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'sessions', 's1'), {
        status: 'open',
        roleSlots: [{ slotId: 'lead', role: 'lead', count: 1, filledBy: [] }],
      });

      const results = await Promise.allSettled([
        trySignup(db, 's1', 'lead', 'alice'),
        trySignup(db, 's1', 'lead', 'bob'),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled' && r.value === 'confirmed').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;

      const finalSnap = await getDoc(doc(db, 'sessions', 's1'));
      const filledBy = (finalSnap.data() as any).roleSlots[0].filledBy as string[];

      expect(filledBy.length).toBe(1); // exactly one cadet in the slot
      expect(won).toBe(1);
      expect(rejected).toBe(1); // the loser was rejected (FULL), not silently dropped
    });
  });

  it('five racing a 2-count slot — exactly two win, no over-fill', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'sessions', 's2'), {
        status: 'open',
        roleSlots: [{ slotId: 'asst', role: 'assistant', count: 2, filledBy: [] }],
      });

      const racers = ['u1', 'u2', 'u3', 'u4', 'u5'];
      const results = await Promise.allSettled(racers.map((u) => trySignup(db, 's2', 'asst', u)));
      const won = results.filter((r) => r.status === 'fulfilled' && r.value === 'confirmed').length;

      const finalSnap = await getDoc(doc(db, 'sessions', 's2'));
      const filledBy = (finalSnap.data() as any).roleSlots[0].filledBy as string[];

      expect(filledBy.length).toBe(2); // never exceeds count
      expect(won).toBe(2);
    });
  });
});
