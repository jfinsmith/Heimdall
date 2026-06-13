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

export function CompleteProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);

  if (!firebaseUser) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      displayName,
      rank,
      agency,
      phone,
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
        <p className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
          After saving, claim your instructor qualifications on the <strong>Profile</strong> page — you will
          need the date you attended each certifying course.
        </p>
        <Button type="submit" variant="primary" disabled={busy}>
          Save profile
        </Button>
      </form>
    </div>
  );
}
