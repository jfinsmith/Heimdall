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

export class SignupError extends Error {}

const submitSignupFn = httpsCallable<{ sessionId: string; slotId: string; allowWaitlist?: boolean }, { status: 'confirmed' | 'waitlist' }>(functions, 'submitSignup');
const withdrawSignupFn = httpsCallable<{ sessionId: string }, { ok: boolean }>(functions, 'withdrawSignup');

const cleanMessage = (e: unknown) => (e instanceof Error ? e.message.replace(/^FirebaseError:\s*/, '') : 'Something went wrong.');

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
  opts: { allowWaitlist?: boolean; orgId?: string } = {}
): Promise<SignupResult> {
  try {
    const res = await submitSignupFn({ sessionId, slotId, allowWaitlist: opts.allowWaitlist });
    return { status: res.data.status };
  } catch (e) {
    const msg = cleanMessage(e);
    throw new SignupError(/FULL/.test(msg) ? 'FULL' : msg);
  }
}

export async function withdrawFromSession(_uid: string, sessionId: string): Promise<void> {
  try {
    await withdrawSignupFn({ sessionId });
  } catch (e) {
    throw new SignupError(cleanMessage(e));
  }
}
