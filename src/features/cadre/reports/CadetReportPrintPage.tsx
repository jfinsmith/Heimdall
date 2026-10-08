/**
 * Clean full-page print view for a single filed cadet report — renders the
 * memorandum with the unified header and a no-print toolbar. Opened in a new tab
 * from the Cadet Reports list.
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { useDoc } from '../../../lib/firestore';
import { useCurriculum } from '../../../lib/curricula';
import type { AcademyDoc, AcademyReportDoc } from '../../../types';
import { Button, Spinner } from '../../../components/ui';
import { ReportLetter } from './ReportLetter';
import { useDirectorName } from './AcademyReports';
import { libraryFormToReportType, useOrgLibraryForms, type LibraryFormDoc } from './documentLibrary';

export function CadetReportPrintPage() {
  const { academyId = '', reportId = '' } = useParams();
  const { data: academy, loading: aLoading } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: report, loading: rLoading } = useDoc<AcademyReportDoc>(
    academyId && reportId ? `academies/${academyId}/reports/${reportId}` : null
  );
  // The class's curriculum drives the unified header (branding + program).
  const { data: curriculum } = useCurriculum(academy?.discipline);
  // Same signer resolution as the form preview (active director first) — this
  // page previously had no active filter, so a suspended director could print.
  const directorName = useDirectorName();
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
        <button type="button" onClick={() => window.close()} className="text-sm text-bifrost-700 hover:underline">Close tab</button>
        <Button variant="primary" onClick={() => window.print()}>Print</Button>
      </div>
      <ReportLetter report={report} directorName={directorName} fromName={report.createdByName ?? ''} reportType={reportType} curriculum={curriculum} />
    </div>
  );
}
