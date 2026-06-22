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

  // Any unfilled [bracketed placeholder] left in the resolved document means it is
  // still DRAFT legal text — surface a banner that prints, so no one issues an
  // official-looking memo with raw placeholders.
  const placeholderTexts = [
    ...memo.headerFields.map((f) => f.value),
    ...memo.blocks.flatMap((b) => (b.spans ?? []).map((s) => (typeof s === 'string' ? s : ''))),
    memo.signerLine,
    memo.acknowledgment ?? '',
    ...(memo.distribution ?? []),
  ];
  const placeholders = Array.from(new Set(placeholderTexts.join('\n').match(/\[[^\]]+\]/g) ?? []));

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-8 text-[11px] leading-snug text-black">
      {placeholders.length > 0 && (
        <div className="mb-4 rounded border-2 border-red-600 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-800">
          DRAFT — not for issue. Replace the bracketed placeholder(s) before signing: {placeholders.join(' · ')}
        </div>
      )}
      <DocumentHeader curriculum={curriculum} settings={settings} />

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
