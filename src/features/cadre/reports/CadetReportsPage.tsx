/**
 * Cadet Reports — standalone entry: pick an academy class, then file/print
 * academic-action reports for it. The per-academy report UI is shared with the
 * Roster module's Reports tab (see AcademyReports).
 */
import React, { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '../../../lib/firestore';
import type { AcademyDoc } from '../../../types';
import { Field, PageHeader, Select } from '../../../components/ui';
import { AcademyReports } from './AcademyReports';

export function CadetReportsPage() {
  const { data: academies } = useCollection<AcademyDoc>('academies', [orderBy('startDate', 'desc')]);
  const realAcademies = useMemo(() => academies.filter((a) => !a.isTemplate), [academies]);
  const [academyId, setAcademyId] = useState('');
  const academy = realAcademies.find((a) => a.id === academyId);

  return (
    <div>
      <PageHeader kicker="CADRE" title="Cadet Reports" />
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-slate-500">
        File academic-action reports against a class and print the official memorandum. Pick the academy,
        choose a report, fill it out, and save it to that class. (Also available from each class's Roster.)
      </p>

      <Field label="Academy class" className="mb-5 max-w-md">
        <Select value={academyId} onChange={(e) => setAcademyId(e.target.value)}>
          <option value="">Select a class…</option>
          {realAcademies.map((a) => (
            <option key={a.id} value={a.id}>{a.shortName ? `${a.shortName} — ${a.name}` : a.name}</option>
          ))}
        </Select>
      </Field>

      {academy ? (
        <AcademyReports academy={academy} />
      ) : (
        <p className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-500">Choose a class to see its reports.</p>
      )}
    </div>
  );
}
