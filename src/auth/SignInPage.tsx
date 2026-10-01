/**
 * Sign-in / registration / password reset — one page, three modes.
 * The night-watch login screen carries the stacked Gjallarhorn lockup.
 */
import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button, Field, Input } from '../components/ui';

type Mode = 'signin' | 'register' | 'reset';

/** Apple sign-in needs an Apple Developer account + the Apple provider enabled
 *  in Firebase Console. The code path is ready — flip this once that's set up. */
const APPLE_SIGNIN_ENABLED = false;
/** Microsoft sign-in needs the Azure app registration + the provider enabled in
 *  Firebase Console (free). Configured 2026-08-05. */
const MICROSOFT_SIGNIN_ENABLED = true;

export function SignInPage() {
  const { firebaseUser, profile, signInWithGoogle, signInWithApple, signInWithMicrosoft, signInWithEmail, registerWithEmail, resetPassword, signOut } =
    useAuth();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // True when the error is really a forgotten password in disguise — renders a
  // one-click "email me a reset link" under the error, so people stop solving
  // "wrong password" by registering themselves a second account.
  const [suggestReset, setSuggestReset] = useState(false);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setSuggestReset(false);
  }

  /** Send the reset link for whatever email is in the form (from the inline
   *  rescue button under an error). Firebase doesn't reveal whether the email
   *  has an account (enumeration protection), so the copy stays neutral. */
  async function sendResetNow() {
    setBusy(true);
    try {
      await resetPassword(email);
      setError(null);
      setSuggestReset(false);
      setMode('signin');
      setInfo(`Password reset email sent to ${email}. Check your inbox (and spam), then sign in with your new password.`);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace('Firebase: ', '') : 'Could not send the reset email.');
    } finally {
      setBusy(false);
    }
  }

  // A deactivated OR suspended account stays authenticated; RequireAuth bounces
  // both here, so BOTH need a terminal notice — redirecting either back into the
  // app loops forever (suspended members used to hit exactly that: /signin → /
  // → RequireAuth → /signin, a frozen blank screen).
  if (firebaseUser && (profile?.status === 'inactive' || profile?.status === 'suspended')) {
    const suspended = profile.status === 'suspended';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
        <WordmarkStacked size={130} />
        <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h1 className="mb-2 text-lg font-semibold text-watch-900">{suspended ? 'Account suspended' : 'Account deactivated'}</h1>
          <p className="text-sm text-slate-600">
            {suspended
              ? `Access for ${profile.email} is suspended. Contact Academy Leadership if you believe this is a mistake.`
              : `Access for ${profile.email} has been turned off. Contact an administrator if you believe this is a mistake.`}
          </p>
          <Button variant="ghost" className="mt-4" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  if (firebaseUser) {
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') await signInWithEmail(email, password);
      else if (mode === 'register')
        await registerWithEmail(email, password, { firstName: firstName.trim(), lastName: lastName.trim(), dob });
      else {
        await resetPassword(email);
        setInfo('Password reset email sent. Check your inbox.');
      }
    } catch (err) {
      // Map the common "forgot my password" failure shapes to guidance + a
      // one-click reset instead of a raw Firebase code — the raw errors are
      // exactly what sent people off to register duplicate accounts.
      const code = (err as { code?: string })?.code ?? '';
      setSuggestReset(false);
      if (
        mode === 'signin' &&
        ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found'].includes(code)
      ) {
        setError(
          "That email and password don't match. If you already have an account — including one set up for you by staff — reset your password instead of creating a new account."
        );
        setSuggestReset(true);
      } else if (mode === 'register' && code === 'auth/email-already-in-use') {
        setError(`An account for ${email} already exists — you don't need to register again. Send yourself a password reset instead:`);
        setSuggestReset(true);
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts — wait a few minutes, or reset your password now:');
        setSuggestReset(true);
      } else {
        setError(err instanceof Error ? err.message.replace('Firebase: ', '') : 'Sign-in failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-watch-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <WordmarkStacked size={150} />
        </div>
        <div className="rounded-xl bg-white p-6 shadow-2xl">
          <h1 className="mb-1 text-lg font-semibold text-watch-900">
            {mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Request an account' : 'Reset password'}
          </h1>
          <p className="mb-4 text-sm text-slate-500">
            {mode === 'register'
              ? 'New instructor accounts are reviewed by a coordinator before activation.'
              : 'Academy training schedule & instructor staffing.'}
          </p>

          {error && (
            <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
              {suggestReset && (
                <Button type="button" variant="secondary" className="mt-2 w-full" disabled={busy || !email} onClick={() => void sendResetNow()}>
                  Email me a password reset link
                </Button>
              )}
            </div>
          )}
          {info && <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}
          {mode === 'register' && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Already have an account — or had one <span className="font-semibold">created for you by staff</span>? Don&apos;t
              register a second one:{' '}
              <button type="button" className="font-semibold underline" onClick={() => switchMode('reset')}>
                reset your password
              </button>{' '}
              instead.
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name">
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
                  </Field>
                  <Field label="Last name">
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
                  </Field>
                </div>
                <Field label="Date of birth" hint="Required — used to verify your training credentials (ATMS)">
                  <Input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    autoComplete="bday"
                  />
                </Field>
              </>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            {mode !== 'reset' && (
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  // Only constrain length when creating an account — sign-in must
                  // accept any existing password (admin temp passwords are 6 chars).
                  minLength={mode === 'register' ? 6 : undefined}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </Field>
            )}
            {mode === 'register' && (
              <p className="text-xs text-slate-500">
                By creating an account you agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener" className="text-bifrost-700 underline">Terms of Service</a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" rel="noopener" className="text-bifrost-700 underline">Privacy Policy</a>.
              </p>
            )}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset email'}
            </Button>
          </form>

          {mode !== 'reset' && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-watch-100" /> or <div className="h-px flex-1 bg-watch-100" />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => signInWithGoogle().catch((e) => setError(e.message))}
              >
                Continue with Google
              </Button>
              {MICROSOFT_SIGNIN_ENABLED && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={busy}
                  onClick={() => signInWithMicrosoft().catch((e) => setError(e.message))}
                >
                  Continue with Microsoft
                </Button>
              )}
              {/* Apple sign-in is fully wired (lib/firebase appleProvider +
                  signInWithApple) but HIDDEN until the Apple Developer account
                  + Firebase Apple provider are configured — flip to true then. */}
              {APPLE_SIGNIN_ENABLED && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={busy}
                  onClick={() => signInWithApple().catch((e) => setError(e.message))}
                >
                   Continue with Apple
                </Button>
              )}
            </>
          )}

          <div className="mt-4 flex justify-between text-xs text-watch-600">
            {mode !== 'signin' && (
              <button className="hover:underline" onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            )}
            {mode === 'signin' && (
              <>
                <button className="hover:underline" onClick={() => switchMode('register')}>
                  Request an account
                </button>
                <button className="hover:underline" onClick={() => switchMode('reset')}>
                  Forgot password?
                </button>
              </>
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-watch-400">Sounded by Gjallarhorn · HEIMDALL</p>
      </div>
    </div>
  );
}
