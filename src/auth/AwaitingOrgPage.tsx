/**
 * Shown to a signed-in user who has no tenant yet (orgId == null) — e.g. a
 * self-registration whose email domain didn't match a configured organization.
 * A graceful holding screen, NOT a hard lockout: the moment an org is assigned
 * (by domain auto-match or a platform owner), the orgId claim/doc updates,
 * AuthContext refreshes, and RequireAuth routes them onward automatically.
 */
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button } from '../components/ui';

export function AwaitingOrgPage() {
  const { firebaseUser, profile, orgId, signOut } = useAuth();
  if (!firebaseUser) return <Navigate to="/signin" replace />;
  // Once a tenant is assigned, leave this screen (pending users fall through to
  // the pending-approval screen via RequireAuth).
  if (profile && orgId) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={130} />
      <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Setting up your account</h1>
        <p className="text-sm text-slate-600">
          Your account ({profile?.email}) was created and is being matched to your organization. If your
          email domain is recognized this completes automatically in a moment — otherwise an administrator
          will assign your account. You’ll be taken in as soon as that happens; this screen updates on its own.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => window.location.reload()}>Refresh</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
