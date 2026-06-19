/**
 * Billing (Phase 14) — the org admin's subscription page. Status comes from the
 * org doc (written only by the Stripe webhook); the two buttons open Stripe's
 * hosted Checkout / Customer Portal. HEIMDALL never handles card data.
 *
 * When Stripe isn't configured for the deployment yet, the callables return a
 * `failed-precondition` and we show a calm "not enabled yet" notice — nothing in
 * the app is gated until an org actually has billing turned on.
 */
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable, type FunctionsError } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useOrg } from '../../lib/useOrg';
import { billingState } from '../../lib/subscription';
import { Badge, Button, PageHeader, Spinner } from '../../components/ui';

const createCheckoutSession = httpsCallable<Record<string, never>, { url: string | null }>(functions, 'createCheckoutSession');
const createBillingPortalSession = httpsCallable<Record<string, never>, { url: string | null }>(functions, 'createBillingPortalSession');

function fmtDate(ms?: number) {
  return typeof ms === 'number' ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
}

export function BillingPage() {
  const { data: org, loading } = useOrg();
  const [params] = useSearchParams();
  const returned = params.get('status'); // 'success' | 'cancel' from Stripe redirect
  const [busy, setBusy] = useState<null | 'checkout' | 'portal'>(null);
  const [error, setError] = useState<string | null>(null);

  const bs = billingState(org);

  async function go(which: 'checkout' | 'portal') {
    setBusy(which);
    setError(null);
    try {
      const fn = which === 'checkout' ? createCheckoutSession : createBillingPortalSession;
      const { data } = await fn({});
      if (data.url) {
        window.location.assign(data.url);
        return; // leaving the app
      }
      setError('Stripe did not return a redirect URL. Please try again.');
    } catch (err) {
      const fe = err as FunctionsError;
      setError(
        fe?.code === 'functions/failed-precondition'
          ? 'Billing isn’t enabled for your organization yet. Contact HEIMDALL to turn it on.'
          : fe?.message || 'Something went wrong starting the billing session.'
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="text-bifrost-400" /></div>;

  const hasCustomer = !!org?.stripeCustomerId;

  return (
    <div className="max-w-2xl">
      <PageHeader kicker="Administration" title="Billing & Subscription" />

      {returned === 'success' && (
        <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          Thanks! Your subscription is being activated — the status below updates within a few seconds.
        </div>
      )}
      {returned === 'cancel' && (
        <div className="mb-4 rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600" role="status">
          Checkout was canceled. No charge was made.
        </div>
      )}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}

      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-watch-500">Current plan</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-watch-900">
              {bs.label}
              {!bs.gated && <Badge tone="green">Complimentary</Badge>}
              {bs.gated && bs.active && !bs.inGrace && <Badge tone="green">Active</Badge>}
              {bs.gated && bs.inGrace && <Badge tone="amber">Grace period</Badge>}
              {bs.gated && !bs.active && <Badge tone="red">Inactive</Badge>}
            </div>
          </div>
        </div>

        {bs.gated && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Renews / ends</dt>
              <dd className="font-medium text-watch-900">{fmtDate(org?.currentPeriodEnd)}</dd>
            </div>
          </dl>
        )}

        {!bs.gated && (
          <p className="mt-3 text-sm text-slate-600">
            Your organization currently has full access at no charge. You can start a paid subscription at any
            time below.
          </p>
        )}
        {bs.gated && !bs.active && (
          <p className="mt-3 text-sm text-red-700">
            Your subscription is inactive. Existing records stay readable, but creating and publishing new
            academies is paused until billing is restored.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="primary" disabled={busy !== null} onClick={() => go('checkout')}>
            {busy === 'checkout' ? 'Opening…' : bs.active && bs.gated ? 'Change plan' : 'Start subscription'}
          </Button>
          {hasCustomer && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => go('portal')}>
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </Button>
          )}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Payments are processed securely by Stripe. HEIMDALL never stores your card details.
        </p>
      </section>
    </div>
  );
}
