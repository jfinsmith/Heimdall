/** Shown to self-registered users awaiting coordinator approval. */
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button } from '../components/ui';

export function PendingApprovalPage() {
  const { firebaseUser, profile, signOut } = useAuth();
  if (!firebaseUser) return <Navigate to="/signin" replace />;
  if (profile && profile.status === 'active') return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={64} className="text-watch-50 [&>svg]:text-bifrost-400" />
      <div className="max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Account pending approval</h1>
        <p className="text-sm text-slate-600">
          The watch has been notified. A coordinator will review your account ({profile?.email}) and
          activate it — you will receive an email when approved.
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
