/**
 * The ONE generic memorandum renderer for HEIMDALL. Renders a MemoDocument with
 * per-org letterhead, a To/From/CC/Date/Re header, body blocks (paragraph /
 * locked clause / legacy jsx), an authority signature, an optional recipient
 * acknowledgment, and an optional distribution footer.
 *
 * Letterhead is per-tenant: the founding PHSC org keeps its official multi-campus
 * header verbatim; every other org uses its uploaded logo + name + tagline.
 *
 * Academic-action letters render through this (via ReportLetter), and so will
 * every document type added in Phase 11 and composed in the builder in Phase 12.
 */
import React from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useGlobalSettings } from '../../../app/providers';
import type { MemoBlock, MemoDocument, MemoSpan } from './memoTypes';

const CAMPUSES = [
  ['EAST CAMPUS', '36727 Blanton Rd., Dade City, FL 33523', '352.567.6701'],
  ['INSTRUCTIONAL PERFORMING ARTS CENTER', '8657 Old Pasco Rd., Wesley Chapel, FL 33544', '813.536.2816'],
  ['NORTH CAMPUS', '11415 Ponce de Leon Blvd., Brooksville, FL 34601', '352.796.6726'],
  ['PORTER CAMPUS AT WIREGRASS RANCH', '2727 Mansfield Blvd., Wesley Chapel, FL 33543', '813.527.6615'],
  ['SPRING HILL CAMPUS', '450 Beverly Ct., Spring Hill, FL 34606', '352.688.8798'],
  ['WEST CAMPUS / DISTRICT OFFICE', '10230 Ridge Rd., New Port Richey, FL 34654', '727.847.2727'],
];

function HeaderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 font-semibold">{label}</span>
      <span className="flex-1 border-b border-black">{children || ' '}</span>
    </div>
  );
}

/** Underlined fill-in blank, mirroring the form's blanks. */
function U({ children }: { children?: React.ReactNode }) {
  const empty = children === undefined || children === null || children === '';
  return <span className="border-b border-black px-1 font-medium">{empty ? '     ' : children}</span>;
}

function Span({ span, data }: { span: MemoSpan; data: Record<string, string> }) {
  if (typeof span === 'string') return <>{span}</>;
  const raw = data[span.field] ?? '';
  const val = span.transform === 'code' ? (raw ? raw.split(' ')[0] : '') : raw;
  return <U>{val || undefined}</U>;
}

function Block({ block, data }: { block: MemoBlock; data: Record<string, string> }) {
  if (block.kind === 'jsx') return <>{block.render?.(data)}</>;
  // paragraph and clause render identically here; 'clause' is metadata that
  // marks the text as locked (uneditable) for the future document builder.
  return (
    <p>
      {(block.spans ?? []).map((s, i) => (
        <Span key={i} span={s} data={data} />
      ))}
    </p>
  );
}

export function MemoRenderer({ document: memo }: { document: MemoDocument }) {
  const settings = useGlobalSettings();
  const { orgId } = useAuth();
  const isFoundingPhsc = orgId === 'phsc';
  const orgTitle = (settings?.orgName || 'Training Academy').toUpperCase();
  const data = memo.data ?? {};

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-8 text-[11px] leading-snug text-black">
      {/* Letterhead — founding PHSC keeps its official multi-campus header; other
          tenants get their own logo + name + tagline. */}
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
        {memo.headerFields.map((f) => (
          <HeaderRow key={f.label} label={f.label}>{f.value}</HeaderRow>
        ))}
      </div>

      <hr className="my-3 border-black" />

      {/* Body blocks */}
      <div className="space-y-2 text-justify [&_p]:m-0">
        {memo.blocks.map((b, i) => (
          <Block key={i} block={b} data={data} />
        ))}
      </div>

      {/* Authority signature */}
      <div className="mt-8">
        <div className="flex items-end gap-6">
          <div className="flex-1 border-t border-black pt-0.5">{memo.signerLine}</div>
          <div className="w-28 border-t border-black pt-0.5">Date</div>
        </div>
      </div>

      {/* Recipient acknowledgment (optional) */}
      {memo.acknowledgment && (
        <>
          <p className="mt-6">{memo.acknowledgment}</p>
          <div className="mt-6 flex items-end gap-6">
            <div className="flex-1 border-t border-black pt-0.5">(Signature)</div>
            <div className="w-28 border-t border-black pt-0.5">Date</div>
          </div>
          {memo.ackSignerLabel && <div className="mt-1 text-[10px]">{memo.ackSignerLabel}</div>}
        </>
      )}

      {/* Distribution footer (optional) */}
      {memo.distribution && memo.distribution.length > 0 && (
        <div className="mt-6 text-[9px] text-black/80">
          {memo.distribution.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
          <div className="mt-1 font-semibold">{memo.reSubject}</div>
        </div>
      )}
    </div>
  );
}
