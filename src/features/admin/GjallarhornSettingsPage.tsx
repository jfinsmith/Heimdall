/**
 * Admin — Gjallarhorn & Email. The control panel for every automated email:
 * per-automation on/off + recipient-role targeting, the reminder / understaffing
 * / escalation windows, escalation recipients, and the weekly digest. Everything
 * on this page is STAGED locally and only written when you press Save at the
 * bottom — nothing takes effect until then.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { EmailAutomationKey, GlobalSettings, Role, UserDoc } from '../../types';
import { EMAIL_AUTOMATIONS } from '../../types';
import { Button, Field, Input, PageHeader, Select, Badge } from '../../components/ui';
import { GjallarhornGlyph } from '../../brand/Logo';
import { logAudit } from '../sessions/audit';

const ROLE_ORDER: Role[] = ['instructor', 'coordinator', 'sergeant', 'lieutenant', 'director'];
const ROLE_SHORT: Record<Role, string> = {
  instructor: 'Instructor',
  coordinator: 'Coordinator',
  sergeant: 'Sergeant',
  lieutenant: 'Lieutenant',
  director: 'Director',
};

export function GjallarhornSettingsPage() {
  const { firebaseUser } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>('settings/global');
  const { data: commandUsers } = useCollection<UserDoc>('users', [
    where('role', 'in', ['coordinator', 'sergeant', 'lieutenant', 'director']),
  ]);

  // Everything below is local until Save.
  const [masterOn, setMasterOn] = useState(true);
  const [automations, setAutomations] = useState<Record<string, boolean>>({});
  const [roles, setRoles] = useState<Record<string, Role[]>>({});
  const [leadHours, setLeadHours] = useState(48);
  const [alertDays, setAlertDays] = useState(7);
  const [escalationDays, setEscalationDays] = useState(7);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [digest, setDigest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMasterOn(settings.emailMasterEnabled !== false);
    setAutomations(Object.fromEntries(EMAIL_AUTOMATIONS.map((a) => [a.key, settings.emailAutomations?.[a.key] !== false])));
    setRoles(Object.fromEntries(EMAIL_AUTOMATIONS.map((a) => [a.key, settings.emailAutomationRoles?.[a.key] ?? []])));
    setLeadHours(settings.reminderDefaultLeadHours ?? 48);
    setAlertDays(settings.understaffingAlertDays ?? 7);
    setEscalationDays(settings.escalationWindowDays ?? 7);
    setRecipients(settings.escalationRecipients ?? []);
    setDigest(settings.weeklyDigestEnabled !== false);
  }, [settings]);

  // A role chip is "on" when there's no filter ([] = all) or the role is listed.
  const roleOn = (key: string, role: Role) => {
    const set = roles[key] ?? [];
    return set.length === 0 || set.includes(role);
  };
  const toggleRole = (key: string, role: Role) =>
    setRoles((prev) => {
      const cur = prev[key] ?? [];
      let next: Role[];
      if (cur.length === 0) {
        next = ROLE_ORDER.filter((r) => r !== role); // was "all" → drop this one
      } else if (cur.includes(role)) {
        if (cur.length === 1) return prev; // never leave zero — turn the email off instead
        next = cur.filter((r) => r !== role);
      } else {
        next = [...cur, role];
      }
      if (next.length === ROLE_ORDER.length) next = []; // all selected = no filter
      return { ...prev, [key]: next };
    });

  const setAllAutomations = (enabled: boolean) =>
    setAutomations(Object.fromEntries(EMAIL_AUTOMATIONS.map((a) => [a.key, enabled])));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await setDoc(
      doc(db, 'settings', 'global'),
      {
        emailMasterEnabled: masterOn,
        emailAutomations: automations,
        emailAutomationRoles: roles,
        reminderDefaultLeadHours: leadHours,
        understaffingAlertDays: alertDays,
        escalationWindowDays: escalationDays,
        escalationRecipients: recipients,
        weeklyDigestEnabled: digest,
      },
      { merge: true }
    );
    await logAudit(firebaseUser!.uid, 'settings.gjallarhorn', 'settings', 'global', 'Updated Gjallarhorn & email settings');
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      masterOn !== (settings.emailMasterEnabled !== false) ||
      leadHours !== (settings.reminderDefaultLeadHours ?? 48) ||
      alertDays !== (settings.understaffingAlertDays ?? 7) ||
      escalationDays !== (settings.escalationWindowDays ?? 7) ||
      digest !== (settings.weeklyDigestEnabled !== false) ||
      JSON.stringify(recipients) !== JSON.stringify(settings.escalationRecipients ?? []) ||
      EMAIL_AUTOMATIONS.some((a) => automations[a.key] !== (settings.emailAutomations?.[a.key] !== false)) ||
      EMAIL_AUTOMATIONS.some((a) => JSON.stringify(roles[a.key] ?? []) !== JSON.stringify(settings.emailAutomationRoles?.[a.key] ?? []))
    );
  }, [settings, masterOn, leadHours, alertDays, escalationDays, digest, recipients, automations, roles]);

  return (
    <form onSubmit={save} className="max-w-3xl pb-24">
      <PageHeader back kicker="Admin" title="Gjallarhorn & Email" />
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-watch-100 bg-watch-900 p-4 text-watch-100">
        <GjallarhornGlyph size={36} className="text-bifrost-400" />
        <p className="text-sm">
          The horn that sounds the summons — confirmations, reminders, understaffing alerts, and command
          escalation. Toggle each email, choose which roles receive it, and tune the alert windows.
        </p>
      </div>

      {/* ── Email automations ──────────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Email automations</h2>
            <p className="text-sm text-slate-500">
              Toggles affect <strong>email only</strong> — in-app bell notifications always fire. The role chips
              limit an email to recipients with those roles (all on = everyone).
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => setAllAutomations(true)}>Enable all</Button>
            <Button type="button" variant="danger" onClick={() => setAllAutomations(false)}>
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
            <input type="checkbox" className="h-5 w-5" checked={masterOn} onChange={(e) => setMasterOn(e.target.checked)} aria-label="Master email switch" />
          </span>
        </label>

        <ul className={`divide-y divide-watch-50 ${masterOn ? '' : 'opacity-50'}`}>
          {EMAIL_AUTOMATIONS.map((a) => {
            const on = automations[a.key] !== false;
            return (
              <li key={a.key} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-medium text-watch-900">{a.label}</span>
                    <span className="block text-xs text-slate-500">{a.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={on}
                    onChange={(e) => setAutomations((p) => ({ ...p, [a.key]: e.target.checked }))}
                    aria-label={`${a.label} emails`}
                  />
                </div>
                {on && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-0.5">
                    <span className="text-xs text-slate-400">Recipients:</span>
                    {ROLE_ORDER.map((r) => {
                      const active = roleOn(a.key, r);
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => toggleRole(a.key, r)}
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 transition ${
                            active
                              ? 'bg-bifrost-50 text-bifrost-700 ring-bifrost-200'
                              : 'bg-white text-slate-300 ring-watch-100 line-through'
                          }`}
                        >
                          {ROLE_SHORT[r]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Windows + recipients ───────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Alert windows</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Reminder lead time (hours)" hint="Default; users can override on their profile">
            <Input type="number" min={1} max={336} value={leadHours} onChange={(e) => setLeadHours(Number(e.target.value))} />
          </Field>
          <Field label="Understaffing window (days)" hint="Alert when required slots are unfilled within this many days">
            <Input type="number" min={1} max={60} value={alertDays} onChange={(e) => setAlertDays(Number(e.target.value))} />
          </Field>
          <Field label="Escalation window (days)" hint="A lead withdrawing within this many days escalates to command">
            <Input type="number" min={1} max={60} value={escalationDays} onChange={(e) => setEscalationDays(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Escalation recipients" hint="Command staff who receive critical alerts (lead withdrawals, understaffing)">
          <Select multiple size={5} value={recipients} onChange={(e) => setRecipients([...e.target.selectedOptions].map((o) => o.value))}>
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
      </section>

      {/* ── Sticky save bar ────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-watch-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
          {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
          {saved && <span className="text-sm text-green-700">Saved.</span>}
          <Button type="submit" variant="primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
