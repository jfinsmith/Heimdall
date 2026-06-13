/**
 * Forced first-login password change. Admin-created accounts land here (the
 * RequireAuth guard redirects while `profile.mustChangePassword` is set) before
 * they can reach the app. The recruit re-enters the temporary password they
 * just signed in with, then chooses their own.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { WordmarkHorizontal } from '../brand/Logo';
import { Button, Field, Input } from '../components/ui';

/** Human-readable text for the Firebase auth errors this form can surface. */
function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
    return 'That temporary password is incorrect.';
  if (code === 'auth/weak-password') return 'Pick a stronger password (at least 6 characters).';
  if (code === 'auth/too-many-requests') return 'Too many attempts — wait a moment and try again.';
  return err instanceof Error ? err.message : 'Could not change the password.';
}

export function ChangePasswordPage() {
  const { firebaseUser, profile, changePassword } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!firebaseUser) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 6) return setError('Your new password must be at least 6 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    if (next === current) return setError('Choose a new password different from the temporary one.');
    setBusy(true);
    try {
      await changePassword(current, next);
      // mustChangePassword is now false; rank may still be unset → guard routes onward.
      navigate('/', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <WordmarkHorizontal size={32} className="mb-8 text-watch-900 [&>svg]:text-bifrost-500" />
      <h1 className="text-xl font-bold text-watch-900">Set your password</h1>
      <p className="mb-6 text-sm text-slate-500">
        Your account was created with a temporary password. Choose your own to continue
        {profile?.displayName ? `, ${profile.displayName.split(' ').slice(-1)[0]}` : ''}.
      </p>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Temporary password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint="At least 6 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save password & continue'}
        </Button>
      </form>
    </div>
  );
}
