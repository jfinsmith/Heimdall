/**
 * Admin — Gjallarhorn settings: reminder defaults, understaffing alert
 * window, escalation recipients, weekly digest toggle.
 */
import React, { useEffect, useState } from 'react';
import { doc, setDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { GlobalSettings, UserDoc } from '../../types';
import { Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { GjallarhornGlyph } from '../../brand/Logo';
import { logAudit } from '../sessions/audit';

export function GjallarhornSettingsPage() {
  const { firebaseUser } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>('settings/global');
  const { data: commandUsers } = useCollection<UserDoc>('users', [
    where('role', 'in', ['coordinator', 'sergeant', 'lieutenant', 'director']),
  ]);

  const [leadHours, setLeadHours] = useState(48);
  const [alertDays, setAlertDays] = useState(7);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [digest, setDigest] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setLeadHours(settings.reminderDefaultLeadHours);
    setAlertDays(settings.understaffingAlertDays);
    setRecipients(settings.escalationRecipients);
    setDigest(settings.weeklyDigestEnabled);
  }, [settings]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await setDoc(
      doc(db, 'settings', 'global'),
      {
        reminderDefaultLeadHours: leadHours,
        understaffingAlertDays: alertDays,
        escalationRecipients: recipients,
        weeklyDigestEnabled: digest,
      },
      { merge: true }
    );
    await logAudit(firebaseUser!.uid, 'settings.gjallarhorn', 'settings', 'global', 'Updated Gjallarhorn settings');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="max-w-xl">
      <PageHeader kicker="Admin" title="Gjallarhorn Settings" />
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-watch-100 bg-watch-900 p-4 text-watch-100">
        <GjallarhornGlyph size={36} className="text-bifrost-400" />
        <p className="text-sm">
          The horn that sounds the summons — reminders, understaffing alerts, and command escalation.
        </p>
      </div>
      <form onSubmit={save} className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <Field label="Default reminder lead time (hours)" hint="Users can override on their profile">
          <Input type="number" min={1} max={168} value={leadHours} onChange={(e) => setLeadHours(Number(e.target.value))} />
        </Field>
        <Field
          label="Understaffing alert window (days)"
          hint="Alert coordinators when required slots are unfilled within this many days of a session"
        >
          <Input type="number" min={1} max={60} value={alertDays} onChange={(e) => setAlertDays(Number(e.target.value))} />
        </Field>
        <Field label="Escalation recipients" hint="Command staff who receive critical alerts (lead withdrawals, understaffing)">
          <Select
            multiple
            size={5}
            value={recipients}
            onChange={(e) => setRecipients([...e.target.selectedOptions].map((o) => o.value))}
          >
            {commandUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.role})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-watch-800">
          <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
          Weekly staffing digest enabled
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">
            Save Gjallarhorn settings
          </Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
