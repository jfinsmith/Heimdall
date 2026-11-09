/**
 * Sign-up / withdrawal — now SERVER-OWNED (audit hardening). The validation +
 * roleSlots/signup/assignment writes run inside an Admin-SDK transaction in the
 * `submitSignup` / `withdrawSignup` Cloud Functions; the security rules forbid a
 * client from writing session.roleSlots, so a non-staff client can no longer
 * hand-edit the staffing of a session. These wrappers keep the original call
 * signatures + the SignupError/'FULL' contract so callers don't change.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { friendlyError } from '../../lib/callableError';

export class SignupError extends Error {}

const submitSignupFn = httpsCallable<{ sessionId: string; slotId: string; allowWaitlist?: boolean }, { status: 'confirmed' | 'waitlist' }>(functions, 'submitSignup');
const withdrawSignupFn = httpsCallable<{ sessionId: string }, { ok: boolean }>(functions, 'withdrawSignup');

export interface SignupResult {
  status: 'confirmed' | 'waitlist';
}

/** Sign the current user up for a slot. `_uid` is ignored — the callable signs
 *  up request.auth.uid (you can only sign yourself up). 'FULL' sentinel preserved
 *  so the UI can offer the waitlist. */
export async function signUpForSlot(
  _uid: string,
  sessionId: string,
  slotId: string,
  opts: { allowWaitlist?: boolean } = {}
): Promise<SignupResult> {
  try {
    const res = await submitSignupFn({ sessionId, slotId, allowWaitlist: !!opts.allowWaitlist });
    return { status: res.data.status };
  } catch (e) {
    // friendlyError turns a blocked/failed transport into plain language and
    // passes the server's own messages through — including the exact 'FULL'
    // sentinel (slot at capacity, waitlist not requested).
    throw new SignupError(friendlyError(e, 'Sign-up failed.'));
  }
}

export async function withdrawFromSession(_uid: string, sessionId: string): Promise<void> {
  try {
    await withdrawSignupFn({ sessionId });
  } catch (e) {
    throw new SignupError(friendlyError(e, 'Withdrawal failed.'));
  }
}
