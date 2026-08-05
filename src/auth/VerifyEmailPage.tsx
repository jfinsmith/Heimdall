/**
 * Email-verification gate for SELF-REGISTERED password accounts (RequireAuth
 * routes here while the account is unverified and org-less). Verification
 * proves the address is deliverable before an organization relies on it —
 * OAuth sign-ins (Google/Microsoft/Apple) arrive pre-verified and skip this,
 * as do admin-created accounts (they're already in an org).
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { Button } from '../components/ui';

export function VerifyEmailPage() {
  const { firebaseUser, resendVerificationEmail, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!firebaseUser) return <Navigate to="/signin" replace />;
  if (firebaseUser.emailVerified) return <Navigate to="/" replace />;

  async function checkVerified() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await auth.currentUser?.reload();
      if (auth.currentUser?.emailVerified) {
        // Hard reload so every auth consumer sees the fresh flag.
        window.location.assign('/');
        return;
      }
      setMsg("Not verified yet — click the link in the email first, then try again. Check spam if it hasn't arrived.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not check verification.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await resendVerificationEmail();
      setMsg(`Verification email re-sent to ${firebaseUser?.email}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the email — wait a minute and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4 text-center">
      <WordmarkStacked size={130} />
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold text-watch-900">Verify your email</h1>
        <p className="text-sm text-slate-600">
          We sent a verification link to <strong className="break-words text-watch-900">{firebaseUser.email}</strong>.
          Click it, then come back here — verifying proves your address can receive schedule and assignment
          emails.
        </p>
        {msg && <p className="mt-3 rounded-md bg-watch-50 px-3 py-2 text-sm text-watch-700">{msg}</p>}
        {err && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="mt-4 space-y-2">
          <Button variant="primary" className="w-full" disabled={busy} onClick={checkVerified}>
            I clicked the link — continue
          </Button>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={resend}>
            Re-send the email
          </Button>
        </div>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
