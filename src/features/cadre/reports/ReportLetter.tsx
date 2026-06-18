/**
 * Printable academic-action memorandum — reproduces the PHSC/FDLE letter layout:
 * letterhead, To/From/CC/Date/Re block, the report-type body, the Academy
 * Director signature, the cadet acknowledgment, and the distribution footer.
 */
import React from 'react';
import type { AcademyReportDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { useGlobalSettings } from '../../../app/providers';
import { getReportType } from './reportTypes';

const CAMPUSES = [
  ['EAST CAMPUS', '36727 Blanton Rd., Dade City, FL 33523', '352.567.6701'],
  ['INSTRUCTIONAL PERFORMING ARTS CENTER', '8657 Old Pasco Rd., Wesley Chapel, FL 33544', '813.536.2816'],
  ['NORTH CAMPUS', '11415 Ponce de Leon Blvd., Brooksville, FL 34601', '352.796.6726'],
  ['PORTER CAMPUS AT WIREGRASS RANCH', '2727 Mansfield Blvd., Wesley Chapel, FL 33543', '813.527.6615'],
  ['SPRING HILL CAMPUS', '450 Beverly Ct., Spring Hill, FL 34606', '352.688.8798'],
  ['WEST CAMPUS / DISTRICT OFFICE', '10230 Ridge Rd., New Port Richey, FL 34654', '727.847.2727'],
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 font-semibold">{label}</span>
      <span className="flex-1 border-b border-black">{children || ' '}</span>
    </div>
  );
}

export function ReportLetter({
  report,
  directorName,
  fromName,
}: {
  report: Pick<AcademyReportDoc, 'type' | 'cadetName' | 'data'> & Partial<WithId<AcademyReportDoc>>;
  directorName: string;
  fromName: string;
}) {
  const type = getReportType(report.type);
  const settings = useGlobalSettings();
  const { orgId } = useAuth();
  if (!type) return null;
  const director = directorName || 'Academy Director';

  // The founding PHSC org keeps its official multi-campus letterhead verbatim;
  // every other tenant gets a letterhead built from its own settings (logo +
  // name + tagline). Jurisdiction gates the statutory body: 'FL' renders the
  // verbatim Florida (FDLE/CJSTC) text; anything else the neutral version.
  const isFoundingPhsc = orgId === 'phsc';
  const fl = (settings?.jurisdiction ?? (isFoundingPhsc ? 'FL' : 'neutral')) === 'FL';
  const renderBody = !fl && type.bodyNeutral ? type.bodyNeutral : type.body;
  const orgTitle = (settings?.orgName || 'Training Academy').toUpperCase();

  // Stored as ISO (yyyy-mm-dd) for clean editing; rendered as M/D/YYYY.
  const fmtD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}/${s.slice(0, 4)}` : s || '');
  const display: Record<string, string> = { ...report.data };
  for (const f of type.fields) if (f.type === 'date' && display[f.key]) display[f.key] = fmtD(display[f.key]);
  display._memoDate = fmtD(display._memoDate);

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-8 text-[11px] leading-snug text-black">
      {/* Letterhead — founding PHSC keeps its official multi-campus header;
          other tenants get their own logo + name + tagline. */}
      {isFoundingPhsc ? (
        <>
          <div className="border-b-2 border-black pb-2 text-center">
            <div className="text-xl font-bold tracking-wide">PASCO-HERNANDO STATE COLLEGE</div>
            <div className="text-[9px] font-semibold tracking-[0.2em]">EXCELLENCE • INTEGRITY • SUCCESS • EQUITY • COMMUNITY</div>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 text-[7px] leading-tight text-black/80">
            {CAMPUSES.map(([n, addr, tel]) => (
              <div key={n}>
                <div className="font-bold">{n}</div>
                <div>{addr}</div>
                <div>{tel}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center border-b-2 border-black pb-2 text-center">
          {settings?.logoUrl && (
            <img src={settings.logoUrl} alt="" style={{ height: 56, width: 'auto', objectFit: 'contain', marginBottom: 6 }} />
          )}
          <div className="text-xl font-bold tracking-wide">{orgTitle}</div>
          {settings?.letterheadTagline && (
            <div className="text-[9px] font-semibold tracking-[0.2em]">{settings.letterheadTagline.toUpperCase()}</div>
          )}
        </div>
      )}

      {/* Memo header */}
      <div className="mt-5 space-y-1">
        <Field label="To:">{report.cadetName}</Field>
        <Field label="From:">{fromName}</Field>
        <Field label="CC:">{`Director ${director}, Academy Director`}</Field>
        <Field label="Date:">{display._memoDate}</Field>
        <Field label="Re:">{type.reSubject}</Field>
      </div>

      <hr className="my-3 border-black" />

      {/* Body — Florida statutory text for FL orgs, neutral text otherwise. */}
      <div className="space-y-2 text-justify [&_p]:m-0">{renderBody(display)}</div>

      {/* Director signature */}
      <div className="mt-8">
        <div className="flex items-end gap-6">
          <div className="flex-1 border-t border-black pt-0.5">Director {director}, Academy Director</div>
          <div className="w-28 border-t border-black pt-0.5">Date</div>
        </div>
      </div>

      {/* Cadet acknowledgment */}
      <p className="mt-6">By signing below, I acknowledge receipt and understanding of this memorandum.</p>
      <div className="mt-6 flex items-end gap-6">
        <div className="flex-1 border-t border-black pt-0.5">(Signature)</div>
        <div className="w-28 border-t border-black pt-0.5">Date</div>
      </div>
      <div className="mt-1 text-[10px]">Cadet</div>

      {/* Distribution footer */}
      <div className="mt-6 text-[9px] text-black/80">
        <div>Cadet</div>
        <div>Director {director}</div>
        <div>Course File, Student File</div>
        <div className="mt-1 font-semibold">{type.reSubject}</div>
      </div>
    </div>
  );
}
