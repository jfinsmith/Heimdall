/**
 * Subscription gating (Phase 14). Single source of truth for "does this org have
 * an active subscription right now?" — read everywhere gating is enforced
 * (AppShell banner, the create-academy guard, the Billing page).
 *
 * SAFE-BY-DEFAULT: gating is OFF unless the org has `billingEnabled === true`.
 * The founding PHSC tenant and any org created before commercialization have no
 * such flag, so they're always unrestricted — nothing regresses. Gating, when
 * on, never blocks READING existing records (handled at the call sites); it only
 * gates new value-creation (publishing/creating academies).
 */
import type { OrgDoc } from '../types';

export type SubscriptionStatus = NonNullable<OrgDoc['subscriptionStatus']>;

export interface BillingState {
  /** Commercialization is turned on for this org (gating is live). */
  gated: boolean;
  /** The org may create/publish right now. */
  active: boolean;
  /** Past the paid period but inside the short grace window. */
  inGrace: boolean;
  status: SubscriptionStatus | 'none';
  /** Human label for the Billing page / banner. */
  label: string;
}

/** Grace after `currentPeriodEnd` before a past_due/unpaid org is restricted. */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const LABELS: Record<SubscriptionStatus | 'none', string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment past due',
  unpaid: 'Unpaid',
  incomplete: 'Finishing sign-up',
  incomplete_expired: 'Sign-up expired',
  paused: 'Paused',
  canceled: 'Canceled',
  none: 'No subscription',
};

export function billingState(org: OrgDoc | null | undefined, now = Date.now()): BillingState {
  const status = (org?.subscriptionStatus ?? 'none') as SubscriptionStatus | 'none';
  const label = LABELS[status] ?? 'Unknown';

  // Not commercialized → unrestricted (founding tenant + pre-billing orgs).
  if (!org || org.billingEnabled !== true) {
    return { gated: false, active: true, inGrace: false, status, label };
  }

  if (status === 'active' || status === 'trialing') {
    return { gated: true, active: true, inGrace: false, status, label };
  }
  // 'incomplete' = the first payment is still in flight (SCA/3DS, async method).
  // Not a lapse — keep access so a customer who just submitted checkout isn't
  // told they're inactive before the first invoice settles. Stripe auto-expires
  // a stuck 'incomplete' to 'incomplete_expired' (~24h), which then gates.
  if (status === 'incomplete') {
    return { gated: true, active: true, inGrace: false, status, label };
  }
  // Grace window: keep access briefly after a missed payment so a transient
  // card decline doesn't instantly wall an academy out of its own tooling.
  const periodOk = typeof org.currentPeriodEnd === 'number' && org.currentPeriodEnd + GRACE_MS > now;
  if ((status === 'past_due' || status === 'unpaid') && periodOk) {
    return { gated: true, active: true, inGrace: true, status, label };
  }
  return { gated: true, active: false, inGrace: false, status, label };
}

/** Convenience: may the org create/publish right now? */
export function billingActive(org: OrgDoc | null | undefined, now = Date.now()): boolean {
  return billingState(org, now).active;
}
