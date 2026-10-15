/**
 * Limbo — index. One card per live class (published / in progress / completed;
 * drafts, archived, and templates are skipped). Each opens that class's
 * day-by-day tracker for the gap between graduation and New Member Training.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '../../../lib/firestore';
import type { AcademyDoc } from '../../../types';
import { Badge, EmptyState, PageHeader } from '../../../components/ui';
import { fmtDate } from '../../../lib/time';

export function LimboPage() {
  const { data: academies, loading } = useCollection<AcademyDoc>('academies', [orderBy('startDate', 'desc')]);
  const live = academies
    .filter((a) => !a.isTemplate && (a.status === 'published' || a.status === 'in_progress' || a.status === 'completed'))
    // Most recently ENDED first — the class whose cadets are in limbo right now.
    .sort((a, b) => b.endDate.toMillis() - a.endDate.toMillis());

  return (
    <div>
      <PageHeader kicker="CADRE — Coordinated Academy Duty & Roster Engine" title="Limbo" />
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Between an academy ending and New Member Training starting, your agency&apos;s new hires are somewhere —
        helping at the range, in validations, studying for the SOCE, on TDY. Pick a class to track where each of
        them is, day by day, and set the NMT start date so it stands out on the chart.
      </p>
      {!loading && live.length === 0 && (
        <EmptyState title="No published classes" body="Limbo tracks cadets from published or completed classes; drafts and archived classes are skipped." />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {live.map((a) => (
          <Link
            key={a.id}
            to={`/cadre/limbo/${a.id}`}
            className="block rounded-lg border border-watch-100 bg-white p-4 shadow-sm transition hover:border-bifrost-300 hover:shadow"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-bold text-bifrost-700">{a.shortName || a.name}</span>
              <Badge tone={a.status === 'completed' ? 'navy' : 'green'}>{a.status.replace('_', ' ')}</Badge>
            </div>
            <div className="mt-1 text-sm text-watch-900">{a.name}</div>
            <div className="mt-2 text-xs text-slate-500">
              {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
            </div>
            <div className="mt-3 text-xs font-semibold text-bifrost-700">Open tracker →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
