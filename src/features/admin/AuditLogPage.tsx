/** Admin — Audit log viewer (read-only; writes come from clients + functions). */
import React from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { useCollection } from '../../lib/firestore';
import type { AuditLogDoc, UserDoc } from '../../types';
import { EmptyState, PageHeader } from '../../components/ui';

export function AuditLogPage() {
  const { data: entries, loading } = useCollection<AuditLogDoc>('auditLog', [orderBy('createdAt', 'desc'), limit(200)]);
  const { data: users } = useCollection<UserDoc>('users');
  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.displayName ?? uid;

  return (
    <div>
      <PageHeader kicker="Admin" title="Audit Log" />
      {!loading && entries.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-watch-50">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                    {e.createdAt?.toDate().toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-watch-800">{nameOf(e.actorUid)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-watch-600">{e.action}</td>
                  <td className="px-4 py-2 text-slate-600">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
