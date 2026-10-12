/**
 * Human-readable text for a failed callable / Firestore / Auth call.
 *
 * The Firebase Functions SDK reports a request that never got a valid HTTP
 * response — a corporate web filter blocking *.run.app, a CORS failure, a
 * dropped connection — as code 'functions/internal' with the bare lowercase
 * message "internal" (HTTP status 0). A genuine server crash arrives as the
 * same code but with the UPPERCASE status "INTERNAL" in the body. Agency and
 * college networks block Cloud Run domains routinely, so the first case must
 * tell the member what to do instead of printing "internal".
 *
 * Real HttpsError messages are already written for humans and pass through
 * unchanged (minus SDK prefixes); everything else falls back to the caller's
 * context-specific text.
 */
export function friendlyError(e: unknown, fallback = 'Something went wrong.'): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  const raw = e instanceof Error ? e.message.replace(/^(?:FirebaseError|Firebase):\s*/, '').trim() : '';
  if (code === 'functions/internal') {
    if (raw === 'internal' || raw === '') {
      return (
        "Couldn't reach HEIMDALL's server. If you're on an agency or college network, a web filter is " +
        'probably blocking it — try a cellular connection or home Wi-Fi, or ask IT to allow *.run.app and *.cloudfunctions.net.'
      );
    }
    return 'Something went wrong on our side — please try again. If it keeps happening, use Report a Problem so we can look at it.';
  }
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return "The server didn't respond in time — check your connection and try again.";
  }
  if (code === 'functions/unauthenticated') return 'Your sign-in has expired — sign in again and retry.';
  if (code === 'functions/resource-exhausted') return 'Too many requests right now — wait a moment and try again.';
  return raw || fallback;
}
