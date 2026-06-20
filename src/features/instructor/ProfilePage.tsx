/**
 * Profile & qualifications. Users edit their own contact info and
 * notification preferences, and may *claim* qualifications — verification is
 * approval-gated (a coordinator verifies via Admin → Users, which is what
 * actually unlocks restricted slots).
 */
// (ChangePasswordCard is defined at the bottom of this file.)
import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useOrg } from '../../lib/useOrg';
import type { Qualification, QualificationKey } from '../../types';
import { QUALIFICATION_LABELS, isInstructorQual } from '../../types';
import { certYearOf, march31, tsFromDate } from '../../lib/time';
import { formatPhone } from '../../lib/format';
import { Badge, Button, Field, Input, PageHeader } from '../../components/ui';

export function ProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  // Default an empty agency to the user's organization (overridable).
  const { data: org } = useOrg();
  useEffect(() => {
    if (org?.legalName && !profile?.agency) setAgency((a) => a || org.legalName);
  }, [org?.legalName, profile?.agency]);
  const [emailOn, setEmailOn] = useState(profile?.notificationPrefs.email ?? true);
  const [leadHours, setLeadHours] = useState(profile?.notificationPrefs.reminderLeadHours ?? 48);
  const [digest, setDigest] = useState(profile?.notificationPrefs.digest ?? true);
  const [saved, setSaved] = useState(false);
  // Optional self-entered FDLE cert expiration year (3/31 of that year). A
  // coordinator confirms/sets it when verifying — it's not required to claim.
  // (Declared with the other hooks, before the early return, per rules-of-hooks.)
  const [certYear, setCertYear] = useState<string>(
    profile?.instructorCertExpires ? String(certYearOf(profile.instructorCertExpires)) : ''
  );
  const [certSaved, setCertSaved] = useState(false);

  if (!firebaseUser || !profile) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Guard against an empty/invalid number input persisting NaN — the reminder
    // sweep does arithmetic on this value.
    const safeLead = Number.isFinite(leadHours) ? Math.min(168, Math.max(1, leadHours)) : 48;
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      phone: formatPhone(phone),
      rank,
      agency,
      notificationPrefs: { email: emailOn, reminderLeadHours: safeLead, digest },
      updatedAt: serverTimestamp(),
    });
    setLeadHours(safeLead);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function saveCertYear() {
    const y = parseInt(certYear, 10);
    if (!y || y < 2000 || y > 2100) return;
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      instructorCertExpires: tsFromDate(march31(y)),
      updatedAt: serverTimestamp(),
    });
    setCertSaved(true);
    setTimeout(() => setCertSaved(false), 2500);
  }

  async function claimQualification(key: QualificationKey) {
    if (profile!.qualifications.some((q) => q.key === key)) return;
    const next: Qualification[] = [
      ...profile!.qualifications,
      { key, label: QUALIFICATION_LABELS[key], verified: false },
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
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} />
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
          Claim the instructor qualifications you hold; a coordinator verifies them before they unlock
          restricted slots. <strong>Role Player</strong> needs no date, but a coordinator still verifies
          it before you’re added to role-player call-outs.
        </p>

        {/* Single FDLE instructor-cert expiration (governs all instructor certs) */}
        <div className="mb-4 rounded-md border border-watch-100 bg-watch-50 px-3 py-3">
          <div className="text-sm font-medium text-watch-800">FDLE instructor certification expiration</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Tied to your General Instructor course and renewed every four years — always 3/31 of the cert
            year. Optional to enter here; a coordinator confirms it when verifying your certs.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              Current:{' '}
              <strong className="text-watch-900">
                {profile.instructorCertExpires ? `3/31/${certYearOf(profile.instructorCertExpires)}` : 'not set'}
              </strong>
            </span>
            <span className="text-slate-400">·</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Cert year
              <Input
                type="number"
                min={2000}
                max={2100}
                placeholder="2027"
                value={certYear}
                onChange={(e) => setCertYear(e.target.value)}
                style={{ width: '6rem' }}
              />
            </label>
            <Button variant="secondary" disabled={!certYear} onClick={saveCertYear}>
              Save expiration
            </Button>
            {certSaved && <span className="text-xs text-green-700">Saved.</span>}
          </div>
        </div>

        <ul className="space-y-2">
          {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => {
            const q = profile.qualifications.find((x) => x.key === key);
            const instructor = isInstructorQual(key);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
                <span className="text-watch-800">
                  {QUALIFICATION_LABELS[key]}
                  {!instructor && <span className="ml-2 text-xs text-slate-400">(no date)</span>}
                  {instructor && q?.verified && profile.instructorCertExpires && (
                    <span className="ml-2 text-xs text-slate-500">expires 3/31/{certYearOf(profile.instructorCertExpires)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {q ? (
                    <>
                      {q.verified ? (
                        <Badge tone="green">Verified</Badge>
                      ) : (
                        <Badge tone="amber">Pending verification</Badge>
                      )}
                      <Button variant="ghost" onClick={() => removeQualification(key)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => claimQualification(key)}>
                      Claim
                    </Button>
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
