/**
 * Admin — Roles & Permissions reference (read-only).
 * The matrix mirrors firestore.rules and the callable functions; it documents
 * what each role can do but does not edit enforcement.
 */
import React from 'react';
import { CHAIN_OF_COMMAND, PERMISSION_MATRIX, ROLE_LABELS, ROLE_SUMMARIES } from '../../lib/rbac';
import { PageHeader } from '../../components/ui';

export function PermissionsPage() {
  return (
    <div>
      <PageHeader
        back
        kicker="Admin"
        title="Roles & Permissions"
        actions={<span className="text-xs text-slate-400">Read-only — enforced by security rules</span>}
      />

      {/* Role summaries, chain of command order */}
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CHAIN_OF_COMMAND.map((role) => (
          <div key={role} className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-bold text-watch-900">{ROLE_LABELS[role]}</h2>
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
                  {ROLE_LABELS[role].replace(' (Captain)', '')}
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
        Director (Captain) and Lieutenant are intentionally identical full administrators. Sergeant has
        full authority over academies and scheduling but no site administration. Coordinators are the
        hands-on schedule builders. Instructors view and sign up. Changing what a role can do requires a
        code/rules change — roles for individual people are assigned under Users &amp; Roles.
      </p>
    </div>
  );
}
