/**
 * Document engine — the block model behind every HEIMDALL memorandum.
 *
 * A document is a MemoDocument: per-org letterhead (added by <MemoRenderer>),
 * a To/From/CC/Date/Re header, a list of body BLOCKS, an authority signature,
 * an optional recipient acknowledgment, and an optional distribution footer.
 *
 * Block kinds:
 *  - 'paragraph' — normal prose composed of spans (literal text + fill-in fields).
 *  - 'clause'    — LOCKED liability/statutory text rendered verbatim: the legal
 *                  text of record.
 *  - 'jsx'       — a render escape hatch for legacy/rich bodies (the existing
 *                  academic letters keep their verbatim legal text as code here,
 *                  so migrating them onto the engine changes nothing they print).
 */
import React from 'react';

/** A span within a paragraph/clause: literal text, or an underlined fill-in field. */
export type MemoSpan = string | { field: string };

export interface MemoBlock {
  kind: 'paragraph' | 'clause' | 'jsx' | 'ratings' | 'notesPage';
  /** For paragraph/clause (and the notesPage heading): the ordered spans. */
  spans?: MemoSpan[];
  /** For jsx: a render function fed the document's fill-in data. */
  render?: (data: Record<string, string>) => React.ReactNode;
  /** For ratings: the statements being rated (one table row each). */
  items?: string[];
  /** For ratings: the scale columns, best first (e.g. "5 — Excellent"). */
  scale?: string[];
  /** For notesPage: how many ruled writing lines (default 26). Starts on a
   *  fresh printed page (break-before). */
  lines?: number;
}

/**
 * Resolve `{token}` placeholders in a template against `ctx`. An unknown or
 * blank token becomes '' — never the literal "{token}". Single pass: text that
 * a token inserts is NOT re-scanned, so a template that embeds another template
 * (the Re: line inside a header row) must be resolved first by the caller.
 */
export function resolveTokens(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => ctx[k] ?? '');
}

/**
 * resolveTokens for a ONE-LINE slot (header row, signature line, distribution
 * entry): also trims the orphan comma/space a blank token leaves at either end,
 * so "{directorName}, Academy Director" with no director on file reads
 * "Academy Director" rather than ", Academy Director".
 */
export function resolveLine(tpl: string, ctx: Record<string, string>): string {
  return resolveTokens(tpl, ctx).replace(/^[\s,]+|[\s,]+$/g, '');
}

export interface MemoHeaderField {
  label: string;
  value: string;
}

export interface MemoDocument {
  /** "Re:" subject; also repeated in the distribution footer. */
  reSubject: string;
  /** Title lines rendered between the letterhead and the divider rule (above
   *  any header rows) — e.g. a form's two-line identity block. Resolved text. */
  titleLines?: string[];
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
  /** Print a small HEIMDALL product-credit line at the very bottom. */
  brandFooter?: boolean;
  /** Tighter spacing for one-page read-and-sign forms (rules sheets etc.). */
  compact?: boolean;
  /** Render a "(Print name)" line ABOVE the acknowledgment signature line. */
  ackPrintedName?: boolean;
  /** Small initials box at the bottom right (label under the box), e.g.
   *  "Training Coordinator initials". Renders beside the distribution lines. */
  initialsBoxLabel?: string;
  /** Fill-in values for field spans and jsx render. */
  data?: Record<string, string>;
}
