/**
 * Platform-owner console (HEIMDALL operator only). Cross-org view of accounts
 * that have no organization yet — the "owner queue": self-registrations that
 * matched no email domain or join code, plus accounts an org admin denied. The
 * owner assigns each to an organization (+ an optional starting role); the
 * account then lands in that org's pending queue for the admin to approve.
 * Backed by platformOwner-gated callables (listOwnerQueue / assignUserToOrg).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { Role } from '../../types';
import { RANKS } from '../../lib/rbac';
import { Badge, Button, PageHeader, Select, Spinner } from '../../components/ui';

interface QueueAccount {
  uid: string;
  email: string;
  displayName: string;
  status: string;
  deniedFromOrgName: string | null;
  createdAtMs: number | null;
}
interface OrgSummary {
  orgId: string;
  legalName: string;
  userCount: number;
}
const listOwnerQueue = httpsCallable<void, { queue: QueueAccount[]; orgs: OrgSummary[] }>(functions, 'listOwnerQueue');
const assignUserToOrg = httpsCallable<{ uid: string; orgId: string; role?: Role }, { ok: boolean }>(functions, 'assignUserToOrg');

export function OwnerConsolePage() {
  const [queue, setQueue] = useState<QueueAccount[]>([]);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listOwnerQueue()
      .then((r) => { setQueue(r.data.queue); setOrgs(r.data.orgs); })
      .catch((e) => setError((e as Error).message || 'Could not load the owner queue.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function assign(uid: string, orgId: string, role: Role) {
    if (!orgId) return;
    setBusy(uid);
    setError(null);
    try {
      await assignUserToOrg({ uid, orgId, role });
      load();
    } catch (e) {
      setError((e as Error).message || 'Could not assign the account.');
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader back kicker="Platform Owner" title="Owner Console" actions={<Button onClick={load}>Refresh</Button>} />
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="mb-6 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Organizations</h2>
        {orgs.length === 0 ? (
          <p className="text-sm text-slate-400">No organizations yet.</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {orgs.map((o) => (
              <li key={o.orgId} className="flex items-center justify-between rounded-md bg-watch-50 px-3 py-1.5 text-sm">
                <span className="font-medium text-watch-800">{o.legalName}</span>
                <span className="text-slate-500">{o.userCount} member{o.userCount === 1 ? '' : 's'} · {o.orgId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-watch-600">
          Unassigned accounts {queue.length > 0 && <Badge tone="amber">{queue.length}</Badge>}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Accounts with no organization — they never matched an email domain or join code, or an org denied them. Assign
          each to an organization and a starting role; they land in that org’s pending queue for the admin to approve.
        </p>
        {loading ? (
          <div className="py-8 text-center"><Spinner className="text-bifrost-400" /></div>
        ) : queue.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No accounts waiting.</p>
        ) : (
          <ul className="space-y-2">
            {queue.map((a) => (
              <QueueRow key={a.uid} a={a} orgs={orgs} busy={busy === a.uid} onAssign={assign} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QueueRow({
  a,
  orgs,
  busy,
  onAssign,
}: {
  a: QueueAccount;
  orgs: OrgSummary[];
  busy: boolean;
  onAssign: (uid: string, orgId: string, role: Role) => void;
}) {
  const [org, setOrg] = useState('');
  const [role, setRole] = useState<Role>('instructor');
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
      <div className="min-w-[12rem] flex-1">
        <div className="font-medium text-watch-900">{a.displayName || a.email || a.uid}</div>
        <div className="text-xs text-slate-500">
          {a.email}
          {a.deniedFromOrgName ? <span className="text-amber-700"> · denied by {a.deniedFromOrgName}</span> : ''}
        </div>
      </div>
      <Select value={org} onChange={(e) => setOrg(e.target.value)} className="w-44">
        <option value="">Choose org…</option>
        {orgs.map((o) => (
          <option key={o.orgId} value={o.orgId}>{o.legalName}</option>
        ))}
      </Select>
      <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-40">
        {[...RANKS].reverse().map((r) => (
          <option key={r.key} value={r.key}>{r.defaultLabel}</option>
        ))}
      </Select>
      <Button variant="primary" disabled={!org || busy} onClick={() => onAssign(a.uid, org, role)}>
        {busy ? 'Assigning…' : 'Assign'}
      </Button>
    </li>
  );
}
