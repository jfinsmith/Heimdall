/**
 * Profile & qualifications. Users edit their own contact info and
 * notification preferences, and may *claim* qualifications — verification is
 * approval-gated (a coordinator verifies via Admin → Users, which is what
 * actually unlocks restricted slots).
 */
import React, { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
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

  async function toggleQualification(key: QualificationKey) {
    const existing = profile!.qualifications.find((q) => q.key === key);
    let next: Qualification[];
    if (existing) {
      // Removing a verified qualification is allowed — re-verification needed to get it back.
      next = profile!.qualifications.filter((q) => q.key !== key);
    } else {
      next = [...profile!.qualifications, { key, label: QUALIFICATION_LABELS[key], verified: false }];
    }
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

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Gjallarhorn preferences</h2>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            Email notifications
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

      <section className="mt-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Qualifications</h2>
        <p className="mb-3 text-sm text-slate-500">
          Claim a qualification here; a coordinator must verify it before it unlocks restricted slots.
        </p>
        <ul className="space-y-2">
          {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => {
            const q = profile.qualifications.find((x) => x.key === key);
            return (
              <li key={key} className="flex items-center justify-between rounded-md border border-watch-100 px-3 py-2 text-sm">
                <span className="text-watch-800">{QUALIFICATION_LABELS[key]}</span>
                <span className="flex items-center gap-2">
                  {q &&
                    (q.verified ? (
                      <Badge tone="green">Verified</Badge>
                    ) : (
                      <Badge tone="amber">Pending verification</Badge>
                    ))}
                  {q?.expires && (
                    <Badge tone={q.expires.toMillis() > Date.now() ? 'navy' : 'red'}>
                      Expires {q.expires.toDate().toLocaleDateString()}
                    </Badge>
                  )}
                  <Button variant={q ? 'ghost' : 'secondary'} onClick={() => toggleQualification(key)}>
                    {q ? 'Remove' : 'Claim'}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
