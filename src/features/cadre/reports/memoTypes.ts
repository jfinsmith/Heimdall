/**
 * Document engine — the block model behind every HEIMDALL memorandum.
 *
 * A document is a MemoDocument: per-org letterhead (added by <MemoRenderer>),
 * a To/From/CC/Date/Re header, a list of body BLOCKS, an authority signature,
 * an optional recipient acknowledgment, and an optional distribution footer.
 *
 * Block kinds:
 *  - 'paragraph' — normal prose composed of spans (literal text + fill-in fields).
 *                  Editable in the document builder (Phase 12).
 *  - 'clause'    — LOCKED liability/statutory text rendered verbatim. The legal
 *                  text of record; the builder must not let it be edited.
 *  - 'jsx'       — a render escape hatch for legacy/rich bodies (the existing
 *                  academic letters keep their verbatim legal text as code here,
 *                  so migrating them onto the engine changes nothing they print).
 */
import React from 'react';

/** A span within a paragraph/clause: literal text, or an underlined fill-in field. */
export type MemoSpan = string | { field: string; transform?: 'code' };

export interface MemoBlock {
  kind: 'paragraph' | 'clause' | 'jsx';
  /** For paragraph/clause: the ordered spans. */
  spans?: MemoSpan[];
  /** For jsx: a render function fed the document's fill-in data. */
  render?: (data: Record<string, string>) => React.ReactNode;
}

export interface MemoHeaderField {
  label: string;
  value: string;
}

export interface MemoDocument {
  /** "Re:" subject; also repeated in the distribution footer. */
  reSubject: string;
  /** To/From/CC/Date/Re rows. */
  headerFields: MemoHeaderField[];
  blocks: MemoBlock[];
  /** Authority signature line (e.g. "Director Jane Doe, Academy Director"). */
  signerLine: string;
  /** Optional recipient-acknowledgment sentence + signature block. */
  acknowledgment?: string;
  /** Label under the acknowledgment signature (e.g. "Cadet"). */
  ackSignerLabel?: string;
  /** Optional distribution footer lines. */
  distribution?: string[];
  /** Fill-in values for field spans and jsx render. */
  data?: Record<string, string>;
}
