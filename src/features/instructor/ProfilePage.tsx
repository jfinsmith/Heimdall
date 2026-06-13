/**
 * Profile & qualifications. Users edit their own contact info and
 * notification preferences, and may *claim* qualifications — verification is
 * approval-gated (a coordinator verifies via Admin → Users, which is what
 * actually unlocks restricted slots).
 */
// (ChangePasswordCard is defined at the bottom of this file.)
import React, { useState } from 'react';
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { Qualification, QualificationKey } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { Badge, Button, Field, Input, PageHeader } from '../../components/ui';

export function ProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  const [emailOn, setEmailOn] = useState(profile?.notificationPrefs.email ?? true);
  const [leadHours, setLeadHours] = useState(profile?.notificationPrefs.reminderLeadHours ?? 48);
  const [digest, setDigest] = useState(profile?.notificationPrefs.digest ?? true);
  const [saved, setSaved] = useState(false);

  if (!firebaseUser || !profile) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      phone,
      rank,
      agency,
      notificationPrefs: { email: emailOn, reminderLeadHours: leadHours, digest },
      updatedAt: serverTimestamp(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Per-row date inputs for new claims (date the certifying course was attended).
  const [claimDates, setClaimDates] = useState<Record<string, string>>({});

  async function claimQualification(key: QualificationKey) {
    const dateStr = claimDates[key];
    if (!dateStr) return;
    const next: Qualification[] = [
      ...profile!.qualifications,
      {
        key,
        label: QUALIFICATION_LABELS[key],
        verified: false,
        attendedOn: Timestamp.fromDate(new Date(`${dateStr}T12:00:00`)),
      },
    ];
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { qualifications: next, updatedAt: serverTimestamp() });
  }

  async function removeQualification(key: QualificationKey) {
    // Removing a verified qualification is allowed — re-verification needed to get it back.
    const next = profile!.qualifications.filter((q) => q.key !== key);
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { qualifications: next, updatedAt: serverTimestamp() });
  }

  return (
    <div className="max-w-2xl">
      <PageHeader kicker="Instructor" title="Profile & Qualifications" />

      <form onSubmit={save} className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-500">
          {profile.displayName} · {profile.email}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Rank">
            <Input value={rank} onChange={(e) => setRank(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Agency">
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} />
        </Field>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wider text-watch-600">My email reminders</h2>
        <p className="text-xs text-slate-500">
          These control your <strong>personal reminder emails</strong> only. Operational notices
          (confirmations, schedule changes, cancellations) are managed by the administrators.
        </p>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            Email me reminders before my assignments
          </label>
          <label className="flex items-center gap-2">
            Reminder lead time:
            <Input
              type="number"
              min={1}
              max={168}
              value={leadHours}
              onChange={(e) => setLeadHours(Number(e.target.value))}
              style={{ width: '5.5rem' }}
            />
            hours before a session
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
            Weekly digest
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">Save</Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </form>

      <ChangePasswordCard />

      <section className="mt-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Qualifications</h2>
        <p className="mb-3 text-sm text-slate-500">
          Claim a qualification with the date you attended the certifying course; a coordinator must
          verify it before it unlocks restricted slots. (Expiration is tracked in the certification portal,
          not here.)
        </p>
        <ul className="space-y-2">
          {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => {
            const q = profile.qualifications.find((x) => x.key === key);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
                <span className="text-watch-800">
                  {QUALIFICATION_LABELS[key]}
                  {q?.attendedOn && (
                    <span className="ml-2 text-xs text-slate-500">
                      attended {q.attendedOn.toDate().toLocaleDateString()}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {q ? (
                    <>
                      {q.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending verification</Badge>}
                      <Button variant="ghost" onClick={() => removeQualification(key)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        Course date
                        <input
                          type="date"
                          aria-label={`Date attended ${QUALIFICATION_LABELS[key]} course`}
                          className="rounded border border-watch-200 px-1.5 py-1 text-xs"
                          value={claimDates[key] ?? ''}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setClaimDates((d) => ({ ...d, [key]: e.target.value }))}
                        />
                      </label>
                      <Button
                        variant="secondary"
                        disabled={!claimDates[key]}
                        title={!claimDates[key] ? 'Enter the date you attended the course first' : undefined}
                        onClick={() => claimQualification(key)}
                      >
                        Claim
                      </Button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * Self-service password change. Only shown for email/password accounts —
 * Google-sign-in users have no password to change here.
 */
function ChangePasswordCard() {
  const { changePassword } = useAuth();
  const hasPassword = auth.currentUser?.providerData.some((p) => p.providerId === 'password') ?? false;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!hasPassword) {
    return (
      <section className="mt-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Password</h2>
        <p className="text-sm text-slate-500">You sign in with Google — manage your password in your Google account.</p>
      </section>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 6) return setError('New password must be at least 6 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'Your current password is incorrect.'
          : err instanceof Error
            ? err.message
            : 'Could not change the password.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">Change password</h2>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 6 characters.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </Button>
          {done && <span className="text-sm text-green-700">Password updated.</span>}
        </div>
      </form>
    </section>
  );
}
