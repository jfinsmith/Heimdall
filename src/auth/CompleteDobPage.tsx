/**
 * One-time ATMS-details gate (RequireAuth routes here when an account has no
 * DOB on file). Accounts that predate the first/last-name + DOB requirement —
 * and OAuth sign-ups, which never asked — supply the verification details
 * ONCE: legal first/last name (prefilled from their display name) and date of
 * birth. New password registrations collect all of this up front and never
 * see this page. (Distinct from /welcome's CompleteProfilePage, the first-time
 * rank/agency/qualifications onboarding.)
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { WordmarkStacked } from '../brand/Logo';
import { splitDisplayName } from '../lib/format';
import { Button, Field, Input } from '../components/ui';

export function CompleteDobPage() {
  const { firebaseUser, profile, signOut } = useAuth();
  const seed = profile ? splitDisplayName(profile.displayName) : { firstName: '', lastName: '' };
  const [firstName, setFirstName] = useState(profile?.firstName ?? seed.firstName);
  const [lastName, setLastName] = useState(profile?.lastName ?? seed.lastName);
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!firebaseUser || !profile) return <Navigate to="/signin" replace />;
  if (profile.dob) return <Navigate to="/" replace />;

  const valid = firstName.trim() !== '' && lastName.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(dob);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', firebaseUser!.uid), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dob,
        displayName: `${firstName.trim()} ${lastName.trim()}`,
        updatedAt: serverTimestamp(),
      });
      // The profile subscription refreshes and the RequireAuth gate releases.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-watch-950 px-4">
      <WordmarkStacked size={130} />
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-1 text-lg font-semibold text-watch-900">One more thing — verify your identity</h1>
        <p className="mb-4 text-sm text-slate-500">
          The academy verifies training credentials against state records (ATMS), which requires your{' '}
          <strong>legal name</strong> and <strong>date of birth</strong> on file. Confirm them once below.
        </p>
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Legal first name">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
            </Field>
            <Field label="Legal last name">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
            </Field>
          </div>
          <Field label="Date of birth">
            <Input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              required
              max={new Date().toISOString().slice(0, 10)}
              autoComplete="bday"
            />
          </Field>
          <Button variant="primary" className="w-full" disabled={busy || !valid} onClick={save}>
            {busy ? 'Saving…' : 'Save & continue'}
          </Button>
        </div>
        <div className="mt-4 text-center text-xs text-watch-600">
          <button className="hover:underline" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
