/**
 * Clean full-page print view for a single filed cadet report — renders the
 * memorandum with the unified header and a no-print toolbar. Opened in a new tab
 * from the Cadet Reports list.
 */
import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { limit, where } from 'firebase/firestore';
import { useCollection, useDoc } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import type { AcademyDoc, AcademyReportDoc, UserDoc } from '../../../types';
import { Button, Spinner } from '../../../components/ui';
import { ReportLetter } from './ReportLetter';
import { libraryFormToReportType, useOrgLibraryForms, type LibraryFormDoc } from './documentLibrary';

export function CadetReportPrintPage() {
  const { academyId = '', reportId = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: report, loading: rLoading } = useDoc<AcademyReportDoc>(
    academyId && reportId ? `academies/${academyId}/reports/${reportId}` : null
  );
  // The class's curriculum drives the unified header (branding + program).
  const { data: curriculum } = useCurriculum(academy?.discipline);
  // lieutenant === director: include both so a lieutenant-led org's leader prints.
  const { data: directors } = useCollection<UserDoc>('users', [where('role', 'in', ['director', 'lieutenant']), limit(2)]);
  const directorName = (directors.find((d) => d.status === 'active') ?? directors[0])?.displayName ?? '';
  // Library forms aren't in the code registry — resolve the report's type by id.
  const { forms } = useOrgLibraryForms();
  // Fallback by-id read so a report filed against a form later deactivated (but
  // still assigned to the org) still resolves + prints, not a blank page.
  const { data: libFallback } = useDoc<LibraryFormDoc>(report?.type ? `documentLibrary/${report.type}` : null);

  if (aLoading || rLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="text-bifrost-400" /></div>;
  if (!academy || !report) return <p className="p-8 text-sm text-slate-500">Report not found.</p>;

  const libForm = forms.find((f) => f.id === report.type) ?? libFallback ?? undefined;
  const reportType = libForm ? libraryFormToReportType(libForm) : undefined;

  return (
    <div>
      <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b border-watch-100 bg-white px-4 py-2">
        <Link to={`/cadet-reports`} className="text-sm text-bifrost-700 hover:underline">← Back to Cadet Reports</Link>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>
      <ReportLetter report={report} directorName={directorName} fromName={report.createdByName ?? ''} reportType={reportType} curriculum={curriculum} />
    </div>
  );
}
