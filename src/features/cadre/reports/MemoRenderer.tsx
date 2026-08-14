/**
 * The ONE generic memorandum renderer for HEIMDALL. Renders a MemoDocument with
 * the unified DocumentHeader, a To/From/CC/Date/Re header, body blocks (paragraph
 * / locked clause / legacy jsx), an authority signature, an optional recipient
 * acknowledgment, and an optional distribution footer.
 *
 * The header (logo + org/discipline/program) comes from DocumentHeader, which
 * resolves branding from the curriculum override → org settings — so every
 * document across the app shares one consistent header.
 */
import React from 'react';
import { useGlobalSettings } from '../../../app/providers';
import type { CurriculumDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { DocumentHeader } from './DocumentHeader';
import type { MemoBlock, MemoDocument, MemoSpan } from './memoTypes';

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

export function MemoRenderer({
  document: memo,
  curriculum,
}: {
  document: MemoDocument;
  curriculum?: WithId<CurriculumDoc> | null;
}) {
  const settings = useGlobalSettings();
  const data = memo.data ?? {};

  // Safety net: the built-in documents carry no [bracketed placeholders] anymore,
  // but owner-authored library forms can — any unresolved bracket in a rendered
  // document surfaces a banner that PRINTS, so nothing incomplete gets issued.
  const placeholderTexts = [
    ...memo.headerFields.map((f) => f.value),
    ...memo.blocks.flatMap((b) => (b.spans ?? []).map((s) => (typeof s === 'string' ? s : ''))),
    memo.signerLine,
    memo.acknowledgment ?? '',
    ...(memo.distribution ?? []),
  ];
  const placeholders = Array.from(new Set(placeholderTexts.join('\n').match(/\[[^\]]+\]/g) ?? []));

  // Compact mode (one-page read-and-sign forms): tighter margins throughout.
  const c = memo.compact === true;

  return (
    <div className={`mx-auto max-w-[8.5in] bg-white ${c ? 'p-5 pb-1' : 'p-8'} text-[11px] leading-snug text-black`}>
      {/* Every document overrides the browser's default ~1in print margins —
          Chrome only honors @page at the TOP level, never inside @media print. */}
      <style>{'@page { margin: 0.45in; }'}</style>
      {placeholders.length > 0 && (
        <div className="mb-4 rounded border-2 border-red-600 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-800">
          NOT FOR ISSUE — complete the bracketed placeholder(s) before signing: {placeholders.join(' · ')}
        </div>
      )}
      <DocumentHeader curriculum={curriculum} settings={settings} />

      {/* Memo header (skipped entirely when a document declares no rows) */}
      {memo.headerFields.length > 0 && (
        <div className={`${c ? 'mt-3' : 'mt-5'} space-y-1`}>
          {memo.headerFields.map((f) => (
            <HeaderRow key={f.label} label={f.label}>{f.value}</HeaderRow>
          ))}
        </div>
      )}

      <hr className={`${c ? 'my-2' : 'my-3'} border-black`} />

      {/* Body blocks */}
      <div className={`${c ? 'space-y-1.5' : 'space-y-2'} text-justify [&_p]:m-0`}>
        {memo.blocks.map((b, i) => (
          <Block key={i} block={b} data={data} />
        ))}
      </div>

      {/* Authority signature (skipped when the document declares no signer line) */}
      {memo.signerLine && (
        <div className={c ? 'mt-5' : 'mt-8'}>
          <div className="flex items-end gap-6">
            <div className="flex-1 border-t border-black pt-0.5">{memo.signerLine}</div>
            <div className="w-28 border-t border-black pt-0.5">Date</div>
          </div>
        </div>
      )}

      {/* Recipient acknowledgment (optional). The signing lines get GENEROUS
          gaps even in compact mode — people hand-write on these. */}
      {memo.acknowledgment && (
        <>
          <p className={c ? 'mt-4' : 'mt-6'}>{memo.acknowledgment}</p>
          {memo.ackPrintedName && (
            <div className="mt-8 flex items-end gap-6">
              <div className="flex-1 border-t border-black pt-0.5">(Print name)</div>
              <div className="w-28" />
            </div>
          )}
          <div className={`${memo.ackPrintedName ? 'mt-8' : c ? 'mt-4' : 'mt-6'} flex items-end gap-6`}>
            <div className="flex-1 border-t border-black pt-0.5">(Signature)</div>
            <div className="w-28 border-t border-black pt-0.5">Date</div>
          </div>
          {memo.ackSignerLabel && <div className="mt-1 text-[10px]">{memo.ackSignerLabel}</div>}
        </>
      )}

      {/* Distribution footer + optional initials box (bottom right) */}
      {((memo.distribution && memo.distribution.length > 0) || memo.initialsBoxLabel) && (
        <div className={`${c ? 'mt-3' : 'mt-6'} flex items-end justify-between gap-4`}>
          <div className="text-[9px] text-black/80">
            {(memo.distribution ?? []).map((d, i) => (
              <div key={i}>{d}</div>
            ))}
            <div className="mt-1 font-semibold">{memo.reSubject}</div>
          </div>
          {memo.initialsBoxLabel && (
            <div className="shrink-0 text-center">
              <div className="h-11 w-24 border border-black" />
              <div className="mt-0.5 text-[8px]">{memo.initialsBoxLabel}</div>
            </div>
          )}
        </div>
      )}

      {/* HEIMDALL product credit (opt-in per document; org branding stays on top) */}
      {memo.brandFooter && (
        <div className={`${c ? 'mt-1' : 'mt-4 border-t border-black/20 pt-1'} text-center text-[8px] tracking-wide text-black/60`}>
          Generated with HEIMDALL Scheduling · heimdallscheduling.com
        </div>
      )}
    </div>
  );
}
