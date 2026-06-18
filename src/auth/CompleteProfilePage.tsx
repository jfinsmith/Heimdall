/**
 * First-time profile completion: name, rank, agency, phone, and requested
 * qualifications (which start unverified — a supervisor must verify before
 * they unlock restricted slots).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useOrg } from '../lib/useOrg';
import { useAuth } from './AuthContext';
import { WordmarkHorizontal } from '../brand/Logo';
import type { Qualification, QualificationKey } from '../types';
import { QUALIFICATION_LABELS, isInstructorQual } from '../types';
import { march31, tsFromDate } from '../lib/time';
import { Button, Field, Input } from '../components/ui';

export function CompleteProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  // Default the agency to the user's organization (overridable — an instructor
  // from a different employing agency can change it). Only fills an empty field.
  const { data: org } = useOrg();
  useEffect(() => {
    if (org?.legalName && !profile?.agency) setAgency((a) => a || org.legalName);
  }, [org?.legalName, profile?.agency]);
  const [claimed, setClaimed] = useState<Record<string, boolean>>(
    () => Object.fromEntries((profile?.qualifications ?? []).map((q) => [q.key, true]))
  );
  const [certYear, setCertYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!firebaseUser) return null;

  function toggle(key: QualificationKey) {
    setClaimed((c) => ({ ...c, [key]: !c[key] }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const qualifications: Qualification[] = (Object.keys(QUALIFICATION_LABELS) as QualificationKey[])
        .filter((k) => claimed[k])
        .map((k) => ({ key: k, label: QUALIFICATION_LABELS[k], verified: false }));
      const y = parseInt(certYear, 10);
      const certExpires = y >= 2000 && y <= 2100 ? { instructorCertExpires: tsFromDate(march31(y)) } : {};
      await updateDoc(doc(db, 'users', firebaseUser!.uid), {
        displayName,
        rank,
        agency,
        phone,
        qualifications,
        ...certExpires,
        updatedAt: serverTimestamp(),
      });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <WordmarkHorizontal size={32} className="mb-8 text-watch-900 [&>svg]:text-bifrost-500" />
      <h1 className="text-xl font-bold text-watch-900">Complete your profile</h1>
      <p className="mb-6 text-sm text-slate-500">
        Requested qualifications must be verified by a coordinator before you can fill restricted slots.
      </p>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Rank" hint='e.g. "Deputy", "Sergeant"'>
            <Input value={rank} onChange={(e) => setRank(e.target.value)} required />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Agency" hint="Defaults to your organization — change it if your employing agency differs">
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} required />
        </Field>

        <div className="rounded-md border border-watch-100 bg-watch-50 px-3 py-3">
          <div className="text-sm font-medium text-watch-800">Your qualifications</div>
          <p className="mt-0.5 mb-2 text-xs text-slate-500">
            Check the instructor qualifications you hold — a coordinator will verify them before they unlock
            restricted slots. <strong>Role Player</strong> needs no date, but is also verified before you’re
            added to role-player call-outs. You can change these any time on your Profile.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-watch-800">
                <input type="checkbox" checked={!!claimed[key]} onChange={() => toggle(key)} />
                {QUALIFICATION_LABELS[key]}
                {!isInstructorQual(key) && <span className="text-xs text-slate-400">(no date)</span>}
              </label>
            ))}
          </div>
          <label className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            FDLE instructor cert expiration year (3/31 of that year) — optional
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
        </div>

        <Button type="submit" variant="primary" disabled={busy}>
          Save profile
        </Button>
      </form>
    </div>
  );
}
