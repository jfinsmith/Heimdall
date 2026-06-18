/**
 * Platform-owner cross-organization audit log. The per-org Audit Log
 * (/admin/audit) shows an org admin only their own org's actions; this view
 * (owner only) spans every organization, via the platformOwner-gated
 * listAllAuditLog callable (the owner's token can't read other orgs directly).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { Badge, Button, PageHeader, Spinner } from '../../components/ui';

interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  actorName: string;
  targetType: string;
  orgId: string | null;
  orgName: string | null;
  createdAtMs: number | null;
}
const listAllAuditLog = httpsCallable<{ limit?: number }, { entries: AuditEntry[] }>(functions, 'listAllAuditLog');

export function OwnerAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listAllAuditLog({ limit: 300 })
      .then((r) => setEntries(r.data.entries))
      .catch((e) => setError((e as Error).message || 'Could not load the audit log.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader kicker="Platform Owner" title="Audit Log (all organizations)" actions={<Button onClick={load}>Refresh</Button>} />
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center"><Spinner className="text-bifrost-400" /></td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No audit entries.</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-watch-50/50">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                    {e.createdAtMs ? new Date(e.createdAtMs).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {e.orgName ? <Badge tone="slate">{e.orgName}</Badge> : <span className="text-xs text-slate-400">platform</span>}
                  </td>
                  <td className="px-4 py-2">{e.actorName}</td>
                  <td className="px-4 py-2"><code className="text-xs text-watch-700">{e.action}</code></td>
                  <td className="px-4 py-2 text-slate-600">{e.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
