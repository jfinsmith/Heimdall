/** Mirrors billingAllows() in firestore.rules — keep the two in step. */
import { describe, it, expect } from 'vitest';
import { billingActive, billingState } from './subscription';
import type { OrgDoc } from '../types';

const NOW = Date.UTC(2026, 10, 9);
const DAY = 864e5;
const org = (over: Partial<OrgDoc>) => ({ orgId: 'x', ...over }) as OrgDoc;

describe('billingState', () => {
  it('never gates an org that is not commercialized (founding tenant, org still loading)', () => {
    for (const o of [null, undefined, org({}), org({ billingEnabled: false, subscriptionStatus: 'canceled' })]) {
      expect(billingState(o, NOW)).toMatchObject({ gated: false, active: true, inGrace: false });
    }
  });
  it('complimentary beats every lapse', () => {
    expect(billingState(org({ complimentary: true, billingEnabled: true, subscriptionStatus: 'canceled' }), NOW)).toMatchObject({
      gated: false, active: true, label: 'Complimentary',
    });
  });
  it('active, trialing and first-payment-in-flight keep access', () => {
    for (const subscriptionStatus of ['active', 'trialing', 'incomplete'] as const) {
      expect(billingState(org({ billingEnabled: true, subscriptionStatus }), NOW)).toMatchObject({ gated: true, active: true, inGrace: false });
    }
  });
  it('past_due / unpaid get exactly three days of grace after the period end', () => {
    for (const subscriptionStatus of ['past_due', 'unpaid'] as const) {
      const at = (endOffset: number) => billingState(org({ billingEnabled: true, subscriptionStatus, currentPeriodEnd: NOW + endOffset }), NOW);
      expect(at(-2 * DAY)).toMatchObject({ active: true, inGrace: true });
      expect(at(-3 * DAY + 1)).toMatchObject({ active: true, inGrace: true });
      expect(at(-3 * DAY)).toMatchObject({ active: false, inGrace: false });
    }
    // No period end on file → no grace.
    expect(billingActive(org({ billingEnabled: true, subscriptionStatus: 'past_due' }), NOW)).toBe(false);
  });
  it('canceled, paused, expired sign-up and "no subscription" are restricted', () => {
    for (const subscriptionStatus of ['canceled', 'paused', 'incomplete_expired', undefined] as const) {
      expect(billingActive(org({ billingEnabled: true, subscriptionStatus, currentPeriodEnd: NOW + 30 * DAY }), NOW)).toBe(false);
    }
    expect(billingState(org({ billingEnabled: true }), NOW)).toMatchObject({ status: 'none', label: 'No subscription' });
  });
});
