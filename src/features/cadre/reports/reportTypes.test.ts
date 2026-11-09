/**
 * Registry integrity — every `{token}` a document prints must resolve to
 * something: one of its own form fields, or a context token ReportLetter
 * supplies. A token that names neither renders as an empty blank on a signed,
 * filed document (and, before the Re: line was resolved first, the injury report
 * printed a literal "{cadetSubject}"). Pure data checks — no rendering.
 */
import { describe, it, expect } from 'vitest';
import { REPORT_TYPES, getReportType } from './reportTypes';
import { resolveLine, resolveTokens } from './memoTypes';

/** Context tokens ReportLetter adds on top of the form's own fields. */
const CONTEXT_TOKENS = ['cadetName', 'fromName', 'directorName', 'memoDate', 'reSubject'];
const tokensIn = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

describe('document registry', () => {
  it('ids are unique and every entry carries a yyyy-mm-dd `updated` stamp', () => {
    const ids = REPORT_TYPES.map((t) => String(t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of REPORT_TYPES) {
      expect(t.updated, `${t.id}.updated`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(getReportType(String(t.id))).toBe(t);
    }
  });

  it('field keys are unique per document and never shadow a context token', () => {
    for (const t of REPORT_TYPES) {
      const keys = t.fields.map((f) => f.key);
      expect(new Set(keys).size, `${t.id} duplicate field key`).toBe(keys.length);
      for (const k of keys) expect(CONTEXT_TOKENS, `${t.id}.${k} shadows a context token`).not.toContain(k);
      for (const f of t.fields) {
        if (f.type === 'select') expect(f.options?.length ?? 0, `${t.id}.${f.key} has no options`).toBeGreaterThan(0);
      }
    }
  });

  it('every {token} resolves to a form field or a context token', () => {
    for (const t of REPORT_TYPES) {
      const known = new Set([...t.fields.map((f) => f.key), ...CONTEXT_TOKENS]);
      const check = (where: string, text: string) => {
        for (const tok of tokensIn(text)) expect(known.has(tok), `${t.id} ${where}: unknown token {${tok}}`).toBe(true);
      };
      // The Re: line is resolved BEFORE {reSubject} exists — it must not use it.
      expect(tokensIn(t.reSubject), `${t.id} reSubject references itself`).not.toContain('reSubject');
      check('reSubject', t.reSubject);
      const d = t.document;
      if (!d) continue;
      (d.titleLines ?? []).forEach((l, i) => check(`titleLines[${i}]`, l));
      d.headerFields.forEach((h) => check(`header "${h.label}"`, h.value));
      d.blocks.forEach((b, i) => check(`blocks[${i}]`, b.text));
      check('signerLine', d.signerLine);
      check('acknowledgment', d.acknowledgment ?? '');
      (d.distribution ?? []).forEach((l, i) => check(`distribution[${i}]`, l));
    }
  });

  it('block-model documents declare a ratings scale + items wherever a ratings block is used', () => {
    for (const t of REPORT_TYPES) {
      for (const b of t.document?.blocks ?? []) {
        if (b.kind !== 'ratings') continue;
        expect(b.items?.length ?? 0, `${t.id} ratings items`).toBeGreaterThan(0);
        expect(b.scale?.length ?? 0, `${t.id} ratings scale`).toBeGreaterThan(0);
        // Rating statements + scale labels print VERBATIM (no token pass) — a
        // {token} in one would reach paper literally.
        for (const s of [...(b.items ?? []), ...(b.scale ?? [])]) expect(tokensIn(s), `${t.id} ratings text "${s}"`).toEqual([]);
      }
    }
  });
});

describe('token resolution', () => {
  const ctx = { cadetName: 'Jane Smith', directorName: '', fromName: 'Sgt. Cole', cadetSubject: 'Jane Smith' };

  it('fills known tokens and blanks unknown ones — a literal {token} never survives', () => {
    expect(resolveTokens('Injury / Illness Report — {cadetSubject}', ctx)).toBe('Injury / Illness Report — Jane Smith');
    expect(resolveTokens('Re: {nope} / {cadetName}', ctx)).toBe('Re:  / Jane Smith');
  });

  it('is single-pass: braces inside a VALUE are left as typed, not re-resolved', () => {
    expect(resolveTokens('{subject}', { subject: 'Policy {cadetName}', cadetName: 'X' })).toBe('Policy {cadetName}');
  });

  it('one-line slots drop the orphan comma a blank token leaves (no ", Academy Director")', () => {
    expect(resolveLine('{directorName}, Academy Director', ctx)).toBe('Academy Director');
    expect(resolveLine('{fromName}, {signerTitle}', ctx)).toBe('Sgt. Cole');
    expect(resolveLine('{cadetName}, Cadet', ctx)).toBe('Jane Smith, Cadet');
    expect(resolveLine('{sponsorContact}', ctx)).toBe(''); // caller drops the empty row/entry
  });
});
