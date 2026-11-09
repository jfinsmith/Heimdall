/** Shown to self-registered users awaiting coordinator approval. */
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { FullPageSpinner } from './guards';
import { WordmarkStacked } from '../brand/Logo';
import { Button } from '../components/ui';

export function PendingApprovalPage() {
  const { firebaseUser, profile, loading, signOut } = useAuth();
  // Auth still resolving (a reload on this page) — wait, don't flash sign-in.
  if (loading) return <FullPageSpinner />;
  if (!firebaseUser) return <Navigate to="/signin" replace />;
  // Anything other than 'pending' (active, suspended, inactive) belongs to
  // RequireAuth's routing, not this holding screen. So does a pending account
  // with NO org (e.g. an admin just denied the request, which clears the org):
  // nobody is reviewing it, so "awaiting verification" would be a dead end —
  // RequireAuth sends it to the join-code screen instead.
  if (profile && (profile.status !== 'pending' || !profile.orgId)) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={130} />
      <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Waiting for account verification</h1>
        <p className="text-sm text-slate-600">
          Your account ({profile?.email}) has been created and is awaiting verification. Academy Leadership
          will review it and assign your role — until then there’s nothing else to see here. You’ll get an
          email the moment your account is activated, and the app will unlock automatically.
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
