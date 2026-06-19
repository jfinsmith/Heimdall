/**
 * Billing (Phase 14) — Stripe subscriptions.
 *
 *   createCheckoutSession      (callable) — admin starts/renews the org's plan;
 *                                           returns a Stripe Checkout URL.
 *   createBillingPortalSession (callable) — admin opens Stripe's hosted portal to
 *                                           manage card / cancel.
 *   stripeWebhook              (HTTP)     — Stripe → us; signature-verified; the
 *                                           ONLY writer of org subscription state.
 *
 * Card data NEVER touches HEIMDALL — Checkout + the Customer Portal are fully
 * Stripe-hosted. Subscription state is written ONLY here via the Admin SDK
 * (orgs are `allow write: if false` for clients), so a tenant can't forge it.
 *
 * Secrets (set with `firebase functions:secrets:set <NAME>`):
 *   STRIPE_SECRET_KEY     — sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET — whsec_… (from the webhook endpoint in the Stripe dash)
 *   STRIPE_PRICE_ID       — price_… of the subscription plan
 * Until they're set, the callables return a friendly "billing not configured"
 * error and nothing in the app changes (gating stays off for every org).
 *
 * WEBHOOK ENDPOINT: point Stripe at the function's DIRECT trigger URL
 *   https://us-east1-<project>.cloudfunctions.net/stripeWebhook
 * (NOT a Firebase Hosting path). Signature verification needs the exact raw
 * request body, which is only guaranteed on the direct invocation — Hosting may
 * re-buffer it and break verification.
 */
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import type { Role } from '../types';
import { ADMIN_ROLES } from '../types';

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_ID = defineSecret('STRIPE_PRICE_ID');

/** Where Stripe sends the user back to (the app domain that hosts /admin/billing). */
const APP_URL = 'https://heimdall.tgcmd-portal.com';

function makeStripe(): Stripe {
  const key = STRIPE_SECRET_KEY.value();
  if (!key) throw new HttpsError('failed-precondition', 'Billing is not configured for this deployment.');
  return new Stripe(key);
}

/** Resolve (and authorize) the caller's org for an admin-only billing action. */
async function requireOrgAdmin(db: Firestore, uid: string | undefined): Promise<{ orgId: string }> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.exists ? snap.data()! : null;
  const role = data?.role as Role | undefined;
  const orgId = data?.orgId as string | undefined;
  if (!role || !ADMIN_ROLES.includes(role) || !orgId) {
    throw new HttpsError('permission-denied', 'Only an organization admin may manage billing.');
  }
  return { orgId };
}

export const createCheckoutSession = onCall<Record<string, never>>(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_ID] },
  async (request) => {
    const db = getFirestore();
    const { orgId } = await requireOrgAdmin(db, request.auth?.uid);
    const priceId = STRIPE_PRICE_ID.value();
    if (!priceId) throw new HttpsError('failed-precondition', 'No subscription price is configured.');
    const stripe = makeStripe();

    const orgRef = db.doc(`orgs/${orgId}`);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');
    const org = orgSnap.data()!;

    // Reuse the org's Stripe customer, or create one keyed back to the org so the
    // webhook can always map an event to a tenant.
    let customerId = org.stripeCustomerId as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: (org.legalName as string) || orgId,
        metadata: { orgId },
      });
      customerId = customer.id;
      await orgRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { metadata: { orgId } },
      success_url: `${APP_URL}/admin/billing?status=success`,
      cancel_url: `${APP_URL}/admin/billing?status=cancel`,
    });
    return { url: session.url };
  }
);

export const createBillingPortalSession = onCall<Record<string, never>>(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const db = getFirestore();
    const { orgId } = await requireOrgAdmin(db, request.auth?.uid);
    const orgSnap = await db.doc(`orgs/${orgId}`).get();
    const customerId = orgSnap.data()?.stripeCustomerId as string | undefined;
    if (!customerId) throw new HttpsError('failed-precondition', 'No billing account yet — start a subscription first.');
    const stripe = makeStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/admin/billing`,
    });
    return { url: session.url };
  }
);

/** Map a Stripe subscription back to its org (metadata → customer metadata → lookup). */
async function resolveOrgId(db: Firestore, stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.orgId) return sub.metadata.orgId;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if (!('deleted' in cust) && cust.metadata?.orgId) return cust.metadata.orgId;
  } catch {
    /* fall through to the orgs lookup */
  }
  const q = await db.collection('orgs').where('stripeCustomerId', '==', customerId).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

/** Idempotently mirror a subscription's state onto its org doc. */
async function applySubscription(db: Firestore, stripe: Stripe, eventSub: Stripe.Subscription): Promise<void> {
  // Re-fetch the canonical subscription so an out-of-order webhook delivery can't
  // overwrite newer state with a stale event snapshot — every handler converges
  // on Stripe's current truth (e.g. a late `updated` can't resurrect a canceled
  // sub). Fall back to the event payload only if the re-fetch fails.
  let sub = eventSub;
  try {
    sub = await stripe.subscriptions.retrieve(eventSub.id);
  } catch (err) {
    console.warn('stripeWebhook: could not re-fetch subscription, using event payload', eventSub.id, err);
  }
  const orgId = await resolveOrgId(db, stripe, sub);
  if (!orgId) {
    console.warn('stripeWebhook: no org for subscription', sub.id);
    return;
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await db.doc(`orgs/${orgId}`).set(
    {
      // Going through checkout flips commercialization ON for this tenant.
      billingEnabled: true,
      subscriptionStatus: sub.status,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      ...(typeof sub.current_period_end === 'number' ? { currentPeriodEnd: sub.current_period_end * 1000 } : {}),
    },
    { merge: true }
  );
}

export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    const key = STRIPE_SECRET_KEY.value();
    const whSecret = STRIPE_WEBHOOK_SECRET.value();
    const sig = req.headers['stripe-signature'];
    if (!key || !whSecret) {
      res.status(500).send('Billing not configured');
      return;
    }
    if (!req.rawBody) {
      // Signature verification needs the exact raw bytes. A missing rawBody means
      // the request was proxied (e.g. via Hosting) — fail loudly, not silently.
      console.error('stripeWebhook: missing rawBody — call the function URL directly, not via Hosting');
      res.status(400).send('Missing raw body');
      return;
    }
    const stripe = new Stripe(key);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig as string, whSecret);
    } catch (err) {
      console.error('stripeWebhook: signature verification failed', err);
      res.status(400).send('Webhook signature verification failed');
      return;
    }

    const db = getFirestore();
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(String(session.subscription));
            await applySubscription(db, stripe, sub);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          await applySubscription(db, stripe, event.data.object as Stripe.Subscription);
          break;
        }
        default:
          break; // ignore the rest
      }
      res.status(200).send('ok');
    } catch (err) {
      console.error('stripeWebhook: handler error', err);
      res.status(500).send('handler error');
    }
  }
);
