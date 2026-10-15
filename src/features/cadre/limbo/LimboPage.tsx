/**
 * Limbo — index. One card per live class (published / in progress / completed;
 * drafts, archived, and templates are skipped), OLDEST first — LE 132 before
 * LE 134 — optionally filtered to one curriculum (remembered per user). Each
 * card opens that class's day-by-day tracker for the gap between graduation
 * and New Member Training.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { doc, orderBy, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useCollection } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { useAllCurricula, baseCurriculumKey } from '../../../lib/curricula';
import type { AcademyDoc } from '../../../types';
import { Badge, EmptyState, PageHeader, Select } from '../../../components/ui';
import { fmtDate } from '../../../lib/time';

export function LimboPage() {
  const { firebaseUser, profile } = useAuth();
  const { data: academies, loading } = useCollection<AcademyDoc>('academies', [orderBy('startDate', 'desc')]);
  const { all: curricula } = useAllCurricula();
  const live = academies
    .filter((a) => !a.isTemplate && (a.status === 'published' || a.status === 'in_progress' || a.status === 'completed'))
    .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());

  // Curriculum filter — remembered on the user's profile so it's not re-picked
  // every visit. '' = every curriculum.
  const chosen = profile?.limboCurriculum ?? '';
  const disciplineLabel = (key: string) =>
    curricula.find((c) => (c.key || baseCurriculumKey(c.id)) === baseCurriculumKey(key))?.label ??
    live.find((a) => a.discipline === key)?.fdleProgram?.replace(/^FDLE\s*/, '') ??
    key;
  const disciplines = [...new Set(live.map((a) => a.discipline))].sort((a, b) => disciplineLabel(a).localeCompare(disciplineLabel(b)));
  const shown = chosen && disciplines.includes(chosen) ? live.filter((a) => a.discipline === chosen) : live;
  async function remember(value: string) {
    if (!firebaseUser) return;
    await updateDoc(doc(db, 'users', firebaseUser.uid), { limboCurriculum: value, updatedAt: serverTimestamp() });
  }

  return (
    <div>
      <PageHeader
        kicker="CADRE — Coordinated Academy Duty & Roster Engine"
        title="Limbo"
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Curriculum
            <Select value={chosen && disciplines.includes(chosen) ? chosen : ''} onChange={(e) => void remember(e.target.value)} className="min-w-[12rem]">
              <option value="">All curricula</option>
              {disciplines.map((d) => (
                <option key={d} value={d}>
                  {disciplineLabel(d)}
                </option>
              ))}
            </Select>
          </label>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Between an academy ending and New Member Training starting, your agency&apos;s new hires are somewhere —
        helping at the range, in validations, studying for the SOCE, on TDY. Pick a class to track where each of
        them is, day by day, and set the NMT start date so it stands out on the chart.
      </p>
      {!loading && shown.length === 0 && (
        <EmptyState title="No published classes" body="Limbo tracks cadets from published or completed classes; drafts and archived classes are skipped." />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => (
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
