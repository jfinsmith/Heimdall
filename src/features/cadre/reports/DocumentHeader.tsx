/**
 * The ONE document header used by every printed document (memos, academic
 * letters, attendance & sign-in rosters). Logo upper-left; org name, tagline,
 * discipline label, and FDLE program + hours on the right; optional address /
 * contact lines beneath; then the document title + class line. The document body
 * ("the information requested below") follows.
 *
 * Branding resolves curriculum override → org settings, so one org can run
 * multiple programs under different identities (e.g. an NMT program branded to
 * the Sheriff's Office).
 */
import React from 'react';
import type { CurriculumDoc, GlobalSettings } from '../../../types';

export function DocumentHeader({
  curriculum,
  settings,
  documentTitle,
  classLine,
}: {
  curriculum?: CurriculumDoc | null;
  settings?: GlobalSettings | null;
  documentTitle?: string;
  classLine?: string;
}) {
  const logo = curriculum?.brandLogoUrl || settings?.logoUrl;
  const orgName = curriculum?.brandOrgName || settings?.orgName || 'Training Academy';
  const tagline = curriculum?.brandTagline || settings?.letterheadTagline;
  const addressLines = curriculum?.brandAddressLines?.length
    ? curriculum.brandAddressLines
    : settings?.letterheadAddressLines;
  const disciplineLabel = curriculum?.label;
  const program = curriculum?.fdleProgram?.replace(/^FDLE\s*/, '');
  const hours = curriculum?.totalHours;

  return (
    <div className="border-b-2 border-black pb-2 text-black">
      <div className="flex items-start gap-3">
        {logo && <img src={logo} alt="" className="h-16 w-auto shrink-0 object-contain" style={{ maxWidth: 150 }} />}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold uppercase leading-tight">{orgName}</div>
          {tagline && <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/70">{tagline}</div>}
          {disciplineLabel && <div className="mt-0.5 text-sm font-semibold">{disciplineLabel}</div>}
          {program && (
            <div className="text-xs text-black/80">
              {program}
              {typeof hours === 'number' && hours > 0 ? ` · ${hours} hrs` : ''}
            </div>
          )}
          {addressLines && addressLines.length > 0 && (
            <div className="mt-1 text-[8px] leading-tight text-black/70">
              {addressLines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(documentTitle || classLine) && (
        <div className="mt-1.5 flex items-baseline justify-between">
          {documentTitle && <div className="text-sm font-semibold uppercase tracking-wide">{documentTitle}</div>}
          {classLine && <div className="text-xs font-medium">{classLine}</div>}
        </div>
      )}
    </div>
  );
}
