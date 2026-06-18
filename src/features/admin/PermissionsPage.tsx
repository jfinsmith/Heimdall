/**
 * Admin — Roles & Permissions.
 * Top: rename ranks (display labels are per-org and editable; the underlying
 * role keys + enforcement never change). Below: the read-only capability matrix
 * that mirrors firestore.rules and the callable functions.
 */
import React, { useEffect, useState } from 'react';
import { deleteField, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { orgConfigPath } from '../../lib/firestore';
import { useGlobalSettings } from '../../app/providers';
import { CHAIN_OF_COMMAND, PERMISSION_MATRIX, RANKS, ROLE_SUMMARIES, getRankLabel } from '../../lib/rbac';
import type { Role } from '../../types';
import { Button, Field, Input, PageHeader } from '../../components/ui';
import { logAudit } from '../sessions/audit';

const stripTitle = (label: string) => label.replace(/\s*\(.*\)\s*$/, '');

export function PermissionsPage() {
  const { firebaseUser, orgId } = useAuth();
  const settings = useGlobalSettings();
  const label = (role: Role) => getRankLabel(role, settings);

  // Editable label inputs, seeded once from the org's current overrides.
  const [labels, setLabels] = useState<Record<Role, string>>(
    () => Object.fromEntries(RANKS.map((r) => [r.key, ''])) as Record<Role, string>
  );
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!seeded && settings) {
      setLabels(Object.fromEntries(RANKS.map((r) => [r.key, settings.roleLabels?.[r.key] ?? ''])) as Record<Role, string>);
      setSeeded(true);
    }
  }, [settings, seeded]);

  async function save() {
    setBusy(true);
    setSaved(false);
    // Store real overrides; explicitly delete cleared/default ones (a merge write
    // deep-merges the nested map, so an omitted key would otherwise persist stale).
    const roleLabels: Record<string, string | ReturnType<typeof deleteField>> = {};
    for (const r of RANKS) {
      const v = labels[r.key]?.trim();
      roleLabels[r.key] = v && v !== r.defaultLabel ? v : deleteField();
    }
    await setDoc(doc(db, orgConfigPath('settings', orgId)), { roleLabels, updatedAt: serverTimestamp() }, { merge: true });
    if (firebaseUser) await logAudit(firebaseUser.uid, 'settings.role_labels', 'settings', 'global', 'Updated rank labels');
    setBusy(false);
    setSaved(true);
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Roles & Permissions"
        actions={<span className="text-xs text-slate-400">Capabilities are enforced by security rules</span>}
      />

      {/* Editable rank labels */}
      <section className="mb-6 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Rank names</h2>
        <p className="mb-3 text-xs text-slate-500">
          Rename ranks to match your agency. This changes only the displayed label — each rank's permissions and
          the underlying role are unchanged.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...RANKS].reverse().map((r) => (
            <Field key={r.key} label={`Default: ${r.defaultLabel}`}>
              <Input
                value={labels[r.key] ?? ''}
                placeholder={r.defaultLabel}
                onChange={(e) => setLabels((p) => ({ ...p, [r.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rank names'}</Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </section>

      {/* Role summaries, chain-of-command order */}
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CHAIN_OF_COMMAND.map((role) => (
          <div key={role} className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-bold text-watch-900">{label(role)}</h2>
            <p className="text-sm text-slate-600">{ROLE_SUMMARIES[role]}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-4 py-3">Capability</th>
              {CHAIN_OF_COMMAND.map((role) => (
                <th key={role} className="px-3 py-3 text-center">
                  {stripTitle(label(role))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {PERMISSION_MATRIX.map((row) => (
              <tr key={row.capability}>
                <td className="px-4 py-2.5 text-watch-800">{row.capability}</td>
                {CHAIN_OF_COMMAND.map((role) => (
                  <td key={role} className="px-3 py-2.5 text-center">
                    {row.roles[role] ? (
                      <span className="font-bold text-status-staffed" aria-label="allowed">✓</span>
                    ) : (
                      <span className="text-watch-200" aria-label="not allowed">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-slate-500">
        {label('director')} and {label('lieutenant')} are intentionally identical full administrators.
        {' '}{stripTitle(label('sergeant'))} has full authority over academies and scheduling but no site
        administration. {label('coordinator')}s are the hands-on schedule builders. {label('instructor')}s
        view and sign up. {label('guest')}s are read-only. Changing what a role can <em>do</em> requires a
        code/rules change — labels are editable above; people are assigned roles under Users &amp; Roles.
      </p>
    </div>
  );
}
