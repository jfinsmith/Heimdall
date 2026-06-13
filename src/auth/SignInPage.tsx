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

export function SignInPage() {
  const { firebaseUser, profile, signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword, signOut } =
    useAuth();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A deactivated account stays authenticated; RequireAuth bounces it to
  // /signin, so show a terminal notice here instead of redirecting back into
  // the app (which would loop).
  if (firebaseUser && profile?.status === 'inactive') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
        <WordmarkStacked size={130} />
        <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h1 className="mb-2 text-lg font-semibold text-watch-900">Account deactivated</h1>
          <p className="text-sm text-slate-600">
            Access for {profile.email} has been turned off. Contact an administrator if you believe this is
            a mistake.
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
      else if (mode === 'register') await registerWithEmail(email, password, displayName);
      else {
        await resetPassword(email);
        setInfo('Password reset email sent. Check your inbox.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.replace('Firebase: ', '') : 'Sign-in failed.');
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

          {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
          {info && <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}

          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <Field label="Full name">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoComplete="name" />
              </Field>
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
            </>
          )}

          <div className="mt-4 flex justify-between text-xs text-watch-600">
            {mode !== 'signin' && (
              <button className="hover:underline" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            )}
            {mode === 'signin' && (
              <>
                <button className="hover:underline" onClick={() => setMode('register')}>
                  Request an account
                </button>
                <button className="hover:underline" onClick={() => setMode('reset')}>
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
