/**
 * Shown to a signed-in user who has no tenant yet (orgId == null) — e.g. a
 * self-registration whose email domain didn't match a configured organization.
 * A graceful holding screen, NOT a hard lockout. The user can enter their
 * organization's SITE JOIN CODE to be routed into that org's pending queue; or
 * wait for the platform owner / a domain match. Once an org is assigned the
 * orgId claim/doc updates, AuthContext refreshes, and RequireAuth routes onward.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button, Field, Input } from '../components/ui';

const joinOrgByCode = httpsCallable<{ code: string }, { ok: boolean }>(functions, 'joinOrgByCode');

export function AwaitingOrgPage() {
  const { firebaseUser, profile, orgId, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  if (!firebaseUser) return <Navigate to="/signin" replace />;
  // Once a tenant is assigned, leave this screen (pending users fall through to
  // the pending-approval screen via RequireAuth).
  if (profile && orgId) return <Navigate to="/" replace />;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await joinOrgByCode({ code: code.trim() });
      // The org now lands on the profile via onSnapshot; AuthContext refreshes the
      // token and RequireAuth routes us into the org's pending queue. Show a brief
      // confirmation in case the snapshot lags a moment.
      setJoined(true);
    } catch (e) {
      setError((e as { message?: string }).message || 'That code did not match an organization.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={130} />
      <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Join your organization</h1>
        <p className="text-sm text-slate-600">
          Your account ({profile?.email}) isn’t linked to an organization yet. If you were given a join code,
          enter it below. Otherwise an administrator will assign your account — this screen updates on its own.
        </p>

        {joined ? (
          <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Joined — finishing setup… you’ll be taken in momentarily.
          </p>
        ) : (
          <form onSubmit={join} className="mt-4 space-y-3 text-left">
            <Field label="Organization join code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter your code" autoFocus />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy || !code.trim()} className="w-full">
              {busy ? 'Joining…' : 'Join organization'}
            </Button>
          </form>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => window.location.reload()}>Refresh</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
