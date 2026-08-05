/**
 * Shown to a signed-in user who has no tenant yet (orgId == null) — the
 * "request to join" home of the self-signup funnel. The user can enter their
 * organization's SITE JOIN CODE (or arrive via an invite link, /join/:code,
 * which stores the code and auto-applies here); a verified email whose domain
 * matches an org auto-routes without any code; otherwise they wait for the
 * platform owner. Once an org is assigned the orgId claim/doc updates,
 * AuthContext refreshes, and RequireAuth routes onward.
 *
 * Accounts that never join an organization are auto-removed after 30 days
 * (accountPurgeDaily) — stated plainly below so nobody is surprised.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button, Field, Input } from '../components/ui';

const joinOrgByCode = httpsCallable<{ code: string }, { ok: boolean }>(functions, 'joinOrgByCode');

/** sessionStorage key an invite link (/join/:code) parks its code under. */
export const JOIN_CODE_KEY = 'hd-join-code';

export function AwaitingOrgPage() {
  const { firebaseUser, profile, orgId, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const autoTried = useRef(false);

  // Invite link: the code was parked before sign-in/registration — apply it
  // automatically, once, the moment the user lands here.
  useEffect(() => {
    if (autoTried.current || !firebaseUser) return;
    let stored = '';
    try { stored = sessionStorage.getItem(JOIN_CODE_KEY) ?? ''; } catch { /* private mode */ }
    if (!stored) return;
    autoTried.current = true;
    setCode(stored);
    setBusy(true);
    joinOrgByCode({ code: stored })
      .then(() => {
        setJoined(true);
        try { sessionStorage.removeItem(JOIN_CODE_KEY); } catch { /* ignore */ }
      })
      .catch((e) => {
        setError((e as { message?: string }).message || 'That invite code did not match an organization.');
        setBusy(false);
      });
  }, [firebaseUser]);

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
      try { sessionStorage.removeItem(JOIN_CODE_KEY); } catch { /* ignore */ }
    } catch (e) {
      setError((e as { message?: string }).message || 'That code did not match an organization.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 py-8 text-center">
      <WordmarkStacked size={130} />
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Request to join your organization</h1>
        <p className="text-sm text-slate-600">
          Your account (<span className="break-words font-medium text-watch-800">{profile?.email}</span>) isn&apos;t
          linked to a training academy yet. Your academy&apos;s <strong>join code</strong> is the fastest way in —
          it&apos;s in your welcome email, or ask your coordinator.
        </p>

        {joined ? (
          <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Joined — finishing setup… you&apos;ll be taken in momentarily.
          </p>
        ) : (
          <form onSubmit={join} className="mt-4 space-y-3 text-left">
            <Field label="Organization join code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. phsc-cadre-2026" autoFocus />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy || !code.trim()} className="w-full">
              {busy ? 'Joining…' : 'Join organization'}
            </Button>
          </form>
        )}

        {!joined && (
          <p className="mt-4 rounded-md bg-watch-50 px-3 py-2 text-left text-xs text-slate-500">
            <strong className="text-watch-700">No code?</strong> You can wait — an administrator can assign your
            account, and this screen updates on its own. Accounts not linked to an organization within{' '}
            <strong>30 days</strong> are automatically removed.
          </p>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => window.location.reload()}>Refresh</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * /join/:code — the shareable invite link ("tap to join" in welcome emails).
 * Parks the code, then routes into the normal funnel: sign-in/registration →
 * (verification) → AwaitingOrgPage, which auto-applies the parked code.
 */
export function JoinInvitePage() {
  const { firebaseUser, loading } = useAuth();
  const code = decodeURIComponent(window.location.pathname.split('/join/')[1] ?? '').trim();
  useEffect(() => {
    if (code) {
      try { sessionStorage.setItem(JOIN_CODE_KEY, code); } catch { /* private mode */ }
    }
  }, [code]);
  if (loading) return null;
  if (!code) return <Navigate to="/signin" replace />;
  // Signed in → the awaiting-org screen applies the code (members with an org
  // just bounce home from there). Signed out → sign in / create an account
  // first; the code survives in sessionStorage.
  return <Navigate to={firebaseUser ? '/awaiting-org' : '/signin'} replace />;
}
