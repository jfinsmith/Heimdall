/**
 * Clean full-page print view for a single filed cadet report — renders the
 * PHSC memorandum and a no-print toolbar. Opened in a new tab from the
 * Cadet Reports list.
 */
import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { limit, where } from 'firebase/firestore';
import { useCollection, useDoc } from '../../../lib/firestore';
import type { AcademyDoc, AcademyReportDoc, UserDoc } from '../../../types';
import { Button, Spinner } from '../../../components/ui';
import { ReportLetter } from './ReportLetter';

export function CadetReportPrintPage() {
  const { academyId = '', reportId = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: report, loading: rLoading } = useDoc<AcademyReportDoc>(
    academyId && reportId ? `academies/${academyId}/reports/${reportId}` : null
  );
  const { data: directors } = useCollection<UserDoc>('users', [where('role', '==', 'director'), limit(1)]);
  const directorName = directors[0]?.displayName ?? 'Academy Director';

  if (aLoading || rLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="text-bifrost-400" /></div>;
  if (!academy || !report) return <p className="p-8 text-sm text-slate-500">Report not found.</p>;

  return (
    <div>
      <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b border-watch-100 bg-white px-4 py-2">
        <Link to={`/cadet-reports`} className="text-sm text-bifrost-700 hover:underline">← Back to Cadet Reports</Link>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>
      <ReportLetter report={report} directorName={directorName} fromName={report.createdByName ?? ''} />
    </div>
  );
}
