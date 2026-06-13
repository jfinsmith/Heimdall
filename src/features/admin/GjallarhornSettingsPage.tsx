/**
 * Admin — Gjallarhorn settings: reminder defaults, understaffing alert
 * window, escalation recipients, weekly digest toggle.
 */
import React, { useEffect, useState } from 'react';
import { doc, setDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { EmailAutomationKey, GlobalSettings, UserDoc } from '../../types';
import { EMAIL_AUTOMATIONS } from '../../types';
import { Button, Field, Input, PageHeader, Select, Badge } from '../../components/ui';
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

  const masterOn = settings?.emailMasterEnabled !== false;
  const automations = settings?.emailAutomations ?? {};

  /** Toggles write immediately — they're switches, not a form. */
  async function setMaster(enabled: boolean) {
    await setDoc(doc(db, 'settings', 'global'), { emailMasterEnabled: enabled }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.email_master', 'settings', 'global', enabled ? 'All email ON' : 'All email OFF');
  }

  async function setAutomation(key: EmailAutomationKey, enabled: boolean) {
    await setDoc(doc(db, 'settings', 'global'), { emailAutomations: { ...automations, [key]: enabled } }, { merge: true });
  }

  async function setAll(enabled: boolean) {
    const all = Object.fromEntries(EMAIL_AUTOMATIONS.map((a) => [a.key, enabled]));
    await setDoc(
      doc(db, 'settings', 'global'),
      { emailAutomations: all, emailMasterEnabled: enabled ? true : masterOn },
      { merge: true }
    );
    await logAudit(firebaseUser!.uid, 'settings.email_all', 'settings', 'global', enabled ? 'Enabled all email automations' : 'Disabled all email automations');
  }

  return (
    <div className="max-w-2xl">
      <PageHeader back kicker="Admin" title="Gjallarhorn & Email" />
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-watch-100 bg-watch-900 p-4 text-watch-100">
        <GjallarhornGlyph size={36} className="text-bifrost-400" />
        <p className="text-sm">
          The horn that sounds the summons — reminders, understaffing alerts, and command escalation.
        </p>
      </div>
      {/* ── Email automations ──────────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Email automations</h2>
            <p className="text-sm text-slate-500">
              Toggles affect <strong>email only</strong> — in-app bell notifications always fire.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setAll(true)}>Enable all</Button>
            <Button variant="danger" onClick={() => setAll(false)}>
              Disable all
            </Button>
          </div>
        </div>

        <label className="mb-3 flex items-center justify-between gap-3 rounded-md border-2 border-watch-200 bg-watch-50 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-watch-900">Master switch — all outbound email</span>
            <span className="block text-xs text-slate-500">
              Kill-switch over everything below. Leave off during setup/testing to avoid burning email quota.
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Badge tone={masterOn ? 'green' : 'red'}>{masterOn ? 'ON' : 'OFF'}</Badge>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={masterOn}
              onChange={(e) => setMaster(e.target.checked)}
              aria-label="Master email switch"
            />
          </span>
        </label>

        <ul className={`divide-y divide-watch-50 ${masterOn ? '' : 'opacity-50'}`}>
          {EMAIL_AUTOMATIONS.map((a) => {
            const on = automations[a.key] !== false;
            return (
              <li key={a.key} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-watch-900">{a.label}</span>
                  <span className="block text-xs text-slate-500">{a.description}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={on}
                  onChange={(e) => setAutomation(a.key, e.target.checked)}
                  aria-label={`${a.label} emails`}
                />
              </li>
            );
          })}
        </ul>
      </section>

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
