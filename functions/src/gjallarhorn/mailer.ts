/**
 * Self-managed replacement for the "Trigger Email from Firestore" extension
 * (Firebase Extensions shut down 2027-03-31). Every email writer queues a doc
 * into `mailQueue` (same shape the extension consumed from `mail`); this
 * trigger sends it through Resend's API and records the outcome on the doc in
 * the extension's familiar `delivery` format.
 *
 * Delivery guarantees — onDocumentCreated is AT-LEAST-ONCE, so double-send is
 * guarded twice over:
 *  1. A transaction "lease": the first invocation flips delivery.state to
 *     PROCESSING; concurrent/duplicate events see the lease and bail. A crash
 *     mid-send leaves PROCESSING, which a redelivered event may re-claim only
 *     after the lease goes STALE (5 min).
 *  2. A Resend idempotency key derived from the doc id: even a re-claimed
 *     send of an email that actually left the building is deduped server-side
 *     (24 h window).
 *
 * Failure handling: transient Resend errors (rate limit, 5xx, quota) mark the
 * doc RETRY and THROW, so Eventarc redelivers with backoff (`retry: true`);
 * permanent errors (bad address, validation) mark ERROR and return. Attempts
 * are capped — the cap converts to a terminal ERROR instead of retrying for
 * the full 7-day event retention.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { Resend, type CreateEmailOptions } from 'resend';
import { MAIL_FROM, MAIL_QUEUE } from './templates';

/** Set once with: firebase functions:secrets:set RESEND_API_KEY */
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60e3; // a PROCESSING claim older than this is a dead run

/** Queue-doc shape (what notify() and the admin callables write). */
interface MailQueueDoc {
  to: string | string[];
  from?: string;
  replyTo?: string | string[];
  message?: {
    subject?: string;
    html?: string;
    text?: string;
    attachments?: { filename?: string; content?: string }[];
  };
  delivery?: {
    state?: 'PROCESSING' | 'RETRY' | 'SUCCESS' | 'ERROR';
    attempts?: number;
    startTime?: Timestamp;
    error?: string;
  };
}

/** Resend error codes worth retrying — everything else is a permanent reject. */
const TRANSIENT_ERRORS = new Set([
  'rate_limit_exceeded',
  'concurrent_idempotent_requests',
  'application_error',
  'internal_server_error',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
]);

export const sendQueuedEmail = onDocumentCreated(
  // Path derives from the SAME constant the writers use — they cannot diverge.
  { document: `${MAIL_QUEUE}/{id}`, secrets: [RESEND_API_KEY], retry: true },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const ref = snap.ref;
    const db = getFirestore();

    // ── 1. Claim the doc (or bail: duplicate event / already sent / exhausted)
    const claim = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) return 'gone';
      const d = cur.data() as MailQueueDoc;
      const state = d.delivery?.state;
      const attempts = d.delivery?.attempts ?? 0;
      if (state === 'SUCCESS' || state === 'ERROR') return 'done';
      if (state === 'PROCESSING') {
        const started = d.delivery?.startTime?.toMillis() ?? 0;
        if (Date.now() - started < LEASE_MS) return 'leased'; // someone's on it
      }
      if (attempts >= MAX_ATTEMPTS) {
        tx.update(ref, {
          'delivery.state': 'ERROR',
          'delivery.error': `Gave up after ${attempts} attempts (last: ${d.delivery?.error ?? 'unknown'}).`,
          'delivery.endTime': FieldValue.serverTimestamp(),
        });
        return 'exhausted';
      }
      tx.update(ref, {
        'delivery.state': 'PROCESSING',
        'delivery.attempts': FieldValue.increment(1),
        'delivery.startTime': FieldValue.serverTimestamp(),
      });
      return 'claimed';
    });
    if (claim === 'leased') {
      // Someone holds the lease. THROW — never ack: if the holder crashed
      // mid-send, acking here would end Eventarc's redelivery and strand the
      // doc in PROCESSING forever. Redeliveries back off until the lease
      // either resolves (next attempt sees 'done' → ack) or goes stale and is
      // re-claimed (the Resend idempotency key keeps that double-send-safe).
      throw new Error(`mailQueue/${event.params.id}: lease held — retry to observe the outcome`);
    }
    if (claim !== 'claimed') {
      if (claim === 'exhausted') logger.error(`mailQueue/${event.params.id}: retry attempts exhausted — marked ERROR`);
      return; // done/gone/exhausted — event acknowledged
    }

    const d = snap.data() as MailQueueDoc;
    const msg = d.message ?? {};
    const to = (Array.isArray(d.to) ? d.to : [d.to]).filter((t): t is string => typeof t === 'string' && !!t);

    /** Terminal failure — record and acknowledge (no redelivery). */
    const fail = async (why: string) => {
      logger.error(`mailQueue/${event.params.id}: ${why}`);
      await ref.update({
        'delivery.state': 'ERROR',
        'delivery.error': why,
        'delivery.endTime': FieldValue.serverTimestamp(),
      });
    };
    /** Transient failure — record and THROW so Eventarc redelivers with backoff.
     *  refundAttempt: quota exhaustion isn't the DOC's fault and outlives the
     *  whole 5-attempt backoff window (attempts burn out in under an hour, the
     *  quota resets at midnight) — give the attempt back so the platform's
     *  event-retention window, not our cap, decides when to give up. */
    const retryLater = async (why: string, refundAttempt = false) => {
      logger.warn(`mailQueue/${event.params.id}: transient failure, will retry — ${why}`);
      await ref.update({
        'delivery.state': 'RETRY',
        'delivery.error': why,
        ...(refundAttempt ? { 'delivery.attempts': FieldValue.increment(-1) } : {}),
      });
      throw new Error(why);
    };

    if (to.length === 0) return fail('No recipient (to) on the mail doc.');
    if (!msg.html && !msg.text) return fail('Mail doc has neither html nor text content.');

    // ── 2. Send via Resend. The SDK returns {data,error} for API-level errors
    // and throws only on network/transport failures (both transient).
    const resend = new Resend(RESEND_API_KEY.value());
    const base = {
      from: d.from || MAIL_FROM,
      to,
      subject: msg.subject || '(no subject)',
      ...(d.replyTo ? { replyTo: d.replyTo } : {}),
      ...(msg.attachments?.length
        ? {
            attachments: msg.attachments
              .filter((a) => typeof a.content === 'string' && a.content.length > 0)
              // Buffer, not raw string: the SDK base64-encodes Buffers, so
              // the .ics text survives transport byte-for-byte.
              .map((a) => ({ filename: a.filename || 'attachment', content: Buffer.from(a.content!, 'utf8') })),
          }
        : {}),
    };
    // Two explicit shapes so TS can prove the SDK's at-least-one-of-html/text
    // union (one IS present — guarded above).
    const payload: CreateEmailOptions = msg.html
      ? { ...base, html: msg.html, ...(msg.text ? { text: msg.text } : {}) }
      : { ...base, text: msg.text! };
    let result: Awaited<ReturnType<typeof resend.emails.send>>;
    try {
      result = await resend.emails.send(
        payload,
        // Dedupe on Resend's side too: a re-claimed stale lease whose first
        // send actually succeeded must not email the person twice.
        { idempotencyKey: `mailq-${event.params.id}` }
      );
    } catch (err) {
      return retryLater(`Network/transport error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (result.error) {
      const { name, message } = result.error;
      if (TRANSIENT_ERRORS.has(name)) {
        return retryLater(`${name}: ${message}`, name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded');
      }
      return fail(`${name}: ${message}`);
    }

    // ── 3. Done — mirror the extension's SUCCESS bookkeeping.
    await ref.update({
      'delivery.state': 'SUCCESS',
      'delivery.info': { messageId: result.data?.id ?? '' },
      'delivery.error': FieldValue.delete(),
      'delivery.endTime': FieldValue.serverTimestamp(),
    });
  }
);
