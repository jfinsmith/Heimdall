/**
 * Adapter: maps a filed academic-action report onto a MemoDocument and renders it
 * through the generic <MemoRenderer> (per-org letterhead + memo chrome). The
 * verbatim legal body (Florida or neutral, per jurisdiction) rides along as a
 * single 'jsx' block, so the printed letter is byte-identical to before — only
 * the chrome is now shared with every other document type.
 */
import React from 'react';
import type { AcademyReportDoc } from '../../../types';
import type { WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { useGlobalSettings } from '../../../app/providers';
import { getReportType } from './reportTypes';
import { MemoRenderer } from './MemoRenderer';
import type { MemoDocument } from './memoTypes';

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

  // 'FL' renders the verbatim Florida (FDLE/CJSTC) body; otherwise the neutral one.
  const fl = (settings?.jurisdiction ?? (orgId === 'phsc' ? 'FL' : 'neutral')) === 'FL';
  const renderBody = !fl && type.bodyNeutral ? type.bodyNeutral : type.body;

  // Stored as ISO (yyyy-mm-dd) for clean editing; rendered as M/D/YYYY.
  const fmtD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}/${s.slice(0, 4)}` : s || '');
  const display: Record<string, string> = { ...report.data };
  for (const f of type.fields) if (f.type === 'date' && display[f.key]) display[f.key] = fmtD(display[f.key]);
  display._memoDate = fmtD(display._memoDate);

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
