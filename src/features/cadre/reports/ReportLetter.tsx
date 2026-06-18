/**
 * Adapter: maps a filed report onto a MemoDocument and renders it through the
 * generic <MemoRenderer> (per-org letterhead + memo chrome).
 *
 *  - Academic-action letters (exam failure, dismissal, …) carry their verbatim
 *    legal body (Florida or neutral, per jurisdiction) as a single 'jsx' block,
 *    so the printed letter is byte-identical to before.
 *  - Phase-11 general & conduct documents define a block-model `document` spec
 *    (paragraph + locked clause blocks, header/signer/distribution templates).
 *    Here we resolve the templates and tokenize the block text into fill-in spans.
 */
import React from 'react';
import type { AcademyReportDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { useGlobalSettings } from '../../../app/providers';
import { getReportType } from './reportTypes';
import { MemoRenderer } from './MemoRenderer';
import type { MemoBlock, MemoDocument, MemoSpan } from './memoTypes';

/** Split block text into spans: `{fieldKey}` → fill-in span, literals → text. */
function toSpans(text: string): MemoSpan[] {
  const spans: MemoSpan[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push(text.slice(last, m.index));
    spans.push({ field: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push(text.slice(last));
  return spans;
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

  // Stored as ISO (yyyy-mm-dd / HH:MM) for clean editing; rendered for print.
  const fmtD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}/${s.slice(0, 4)}` : s || '');
  const fmtT = (s?: string) => {
    if (!s || !/^\d{2}:\d{2}$/.test(s)) return s || '';
    const [h, m] = s.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const display: Record<string, string> = { ...report.data };
  for (const f of type.fields) {
    if (display[f.key] === undefined) continue;
    if (f.type === 'date') display[f.key] = fmtD(display[f.key]);
    else if (f.type === 'time') display[f.key] = fmtT(display[f.key]);
  }
  display._memoDate = fmtD(display._memoDate);

  // ── Block-model document (Phase 11) ──────────────────────────────────────
  if (type.document) {
    const doc = type.document;
    // Context available to header/signer/distribution templates and block tokens.
    const ctx: Record<string, string> = {
      ...display,
      cadetName: report.cadetName ?? '',
      fromName,
      directorName: director,
      memoDate: display._memoDate,
      reSubject: type.reSubject,
    };
    const resolve = (tpl: string) => tpl.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');

    const memo: MemoDocument = {
      reSubject: resolve(type.reSubject),
      // Resolve each header value; trim orphan commas/space left by a blank
      // optional token (e.g. an unfilled CC) and drop rows that end up empty.
      headerFields: doc.headerFields
        .map((h) => ({ label: h.label, value: resolve(h.value).replace(/^[\s,]+|[\s,]+$/g, '') }))
        .filter((h) => h.value !== ''),
      blocks: doc.blocks.map<MemoBlock>((b) => ({ kind: b.kind, spans: toSpans(b.text) })),
      signerLine: resolve(doc.signerLine),
      acknowledgment: doc.acknowledgment ? resolve(doc.acknowledgment) : undefined,
      ackSignerLabel: doc.ackSignerLabel || undefined,
      distribution: doc.distribution?.map(resolve),
      data: ctx,
    };
    return <MemoRenderer document={memo} />;
  }

  // ── Legacy academic-action letter (verbatim jsx body) ────────────────────
  // 'FL' renders the verbatim Florida (FDLE/CJSTC) body; otherwise the neutral one.
  const fl = (settings?.jurisdiction ?? (orgId === 'phsc' ? 'FL' : 'neutral')) === 'FL';
  const renderBody = !fl && type.bodyNeutral ? type.bodyNeutral : type.body;
  if (!renderBody) return null;

  const memo: MemoDocument = {
    reSubject: type.reSubject,
    headerFields: [
      { label: 'To:', value: report.cadetName ?? '' },
      { label: 'From:', value: fromName },
      { label: 'CC:', value: `Director ${director}, Academy Director` },
      { label: 'Date:', value: display._memoDate },
      { label: 'Re:', value: type.reSubject },
    ],
    blocks: [{ kind: 'jsx', render: () => renderBody(display) }],
    signerLine: `Director ${director}, Academy Director`,
    acknowledgment: 'By signing below, I acknowledge receipt and understanding of this memorandum.',
    ackSignerLabel: 'Cadet',
    distribution: ['Cadet', `Director ${director}`, 'Course File, Student File'],
    data: display,
  };

  return <MemoRenderer document={memo} />;
}
