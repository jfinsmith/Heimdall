/**
 * Shown to a signed-in member whose ORGANIZATION's access has been suspended by
 * the platform owner (setOrgSuspension). A hard hold — the platform owner is
 * exempt so they can still operate the Owner Console to lift it. Auto-lifts when
 * the org is reactivated: useOrg live-updates, RequireAuth routes onward.
 */
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useOrg } from '../lib/useOrg';
import { FullPageSpinner } from './guards';
import { WordmarkStacked } from '../brand/Logo';
import { Button } from '../components/ui';

export function OrgSuspendedPage() {
  const { firebaseUser, profile, platformOwner, loading, signOut } = useAuth();
  const { data: org } = useOrg();

  // Auth still resolving (the Refresh button reloads this page) — wait, don't
  // flash the sign-in form.
  if (loading) return <FullPageSpinner />;
  if (!firebaseUser) return <Navigate to="/signin" replace />;
  // Owner is exempt; once the org is no longer suspended, leave this screen.
  // (An account with no org at all has nothing to be suspended — a typed URL.)
  if (platformOwner || (profile && !profile.orgId) || (profile && org && org.status !== 'suspended')) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={130} />
      <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Access suspended</h1>
        <p className="text-sm text-slate-600">
          {org?.legalName ? <><strong>{org.legalName}</strong>’s</> : 'Your organization’s'} access to HEIMDALL is
          currently suspended.{org?.suspendedReason ? ` Reason: ${org.suspendedReason}.` : ''} Please contact your
          administrator or HEIMDALL support. This screen updates on its own once access is restored.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => window.location.reload()}>Refresh</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
