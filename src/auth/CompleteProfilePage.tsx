/**
 * First-time profile completion: name, rank, agency, phone, and requested
 * qualifications (which start unverified — a supervisor must verify before
 * they unlock restricted slots).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { WordmarkHorizontal } from '../brand/Logo';
import { Button, Field, Input } from '../components/ui';
import { QUALIFICATION_LABELS, type Qualification, type QualificationKey } from '../types';

export function CompleteProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [quals, setQuals] = useState<Set<QualificationKey>>(new Set(['general']));
  const [busy, setBusy] = useState(false);

  if (!firebaseUser) return null;

  function toggleQual(key: QualificationKey) {
    setQuals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const qualifications: Qualification[] = [...quals].map((key) => ({
      key,
      label: QUALIFICATION_LABELS[key],
      verified: false, // approval-gated: a supervisor verifies before restricted slots unlock
    }));
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      displayName,
      rank,
      agency,
      phone,
      qualifications,
      updatedAt: serverTimestamp(),
    });
    navigate('/');
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <WordmarkHorizontal size={32} className="mb-8 text-watch-900 [&>svg]:text-bifrost-500" />
      <h1 className="text-xl font-bold text-watch-900">Complete your profile</h1>
      <p className="mb-6 text-sm text-slate-500">
        Requested qualifications must be verified by a coordinator before you can fill restricted slots.
      </p>
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
        <Field label="Agency" hint='e.g. "Example County Sheriff’s Office"'>
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} required />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-watch-800">Qualifications to request</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => (
              <label key={key} className="flex items-center gap-2 rounded-md border border-watch-200 px-3 py-2 text-sm">
                <input type="checkbox" checked={quals.has(key)} onChange={() => toggleQual(key)} />
                {QUALIFICATION_LABELS[key]}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" variant="primary" disabled={busy}>
          Save profile
        </Button>
      </form>
    </div>
  );
}
