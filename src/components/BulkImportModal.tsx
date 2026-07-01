/**
 * Reusable CSV bulk-import modal (item 5). Paste or upload a CSV; the modal maps
 * the header row to the declared columns (alias- and order-tolerant), validates
 * each row, previews valid/invalid rows, then imports the valid ones one at a time
 * through the caller's `importRow` (a Cloud Function), reporting per-row results.
 * It never imports a row flagged invalid, and a failure on one row doesn't abort
 * the rest.
 */
import React, { useMemo, useRef, useState } from 'react';
import { parseCsv } from '../lib/csv';
import { Modal } from './Modal';
import { Button } from './ui';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** Accepted header variants (case/space/underscore-insensitive). */
  aliases?: string[];
}

interface ParsedImportRow {
  line: number;
  record: Record<string, string>;
  errors: string[];
}

interface ImportResult { line: number; name: string; ok: boolean; error?: string }

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, '');

export function BulkImportModal({
  title, columns, exampleRow, rowLabel, validateRow, importRow, confirmNote, onClose, onComplete,
}: {
  title: string;
  columns: ImportColumn[];
  /** A sample data line shown in the help text (no header). */
  exampleRow: string;
  /** Human label for a row (e.g. the person's name) — shown in results. */
  rowLabel: (record: Record<string, string>) => string;
  /** Return a list of problems; an empty list means the row is importable. */
  validateRow: (record: Record<string, string>) => string[];
  importRow: (record: Record<string, string>) => Promise<void>;
  /** Optional caution shown above the Import button (e.g. "creates accounts + emails"). */
  confirmNote?: string;
  onClose: () => void;
  /** Called once after a run in which at least one row succeeded. */
  onComplete?: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const headerLine = useMemo(() => columns.map((c) => c.label).join(','), [columns]);

  const parsed = useMemo<ParsedImportRow[]>(() => {
    const text = raw.trim();
    if (!text) return [];
    const grid = parseCsv(text);
    if (grid.length === 0) return [];
    const colByNorm = new Map<string, ImportColumn>();
    for (const c of columns) {
      colByNorm.set(norm(c.label), c);
      for (const a of c.aliases ?? []) colByNorm.set(norm(a), c);
    }
    const firstIsHeader = grid[0].some((h) => colByNorm.has(norm(h)));
    const order: (ImportColumn | null)[] = firstIsHeader
      ? grid[0].map((h) => colByNorm.get(norm(h)) ?? null)
      : columns;
    const dataRows = firstIsHeader ? grid.slice(1) : grid;
    // Line numbers match the source file (header counts as line 1) so an error
    // report sends the user to the right spreadsheet row.
    const lineOffset = firstIsHeader ? 2 : 1;
    return dataRows.map((cells, idx) => {
      const record: Record<string, string> = {};
      order.forEach((col, i) => { if (col) record[col.key] = (cells[i] ?? '').trim(); });
      return { line: idx + lineOffset, record, errors: validateRow(record) };
    });
  }, [raw, columns, validateRow]);

  const valid = parsed.filter((p) => p.errors.length === 0);
  const invalid = parsed.filter((p) => p.errors.length > 0);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) f.text().then(setRaw);
  }

  async function runImport() {
    setBusy(true);
    setProgress({ done: 0, total: valid.length });
    const out: ImportResult[] = [];
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      try {
        await importRow(r.record);
        out.push({ line: r.line, name: rowLabel(r.record), ok: true });
      } catch (err) {
        out.push({ line: r.line, name: rowLabel(r.record), ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setResults(out);
    setBusy(false);
    if (out.some((r) => r.ok)) onComplete?.();
  }

  // ── Results view ──────────────────────────────────────────────────────────
  if (results) {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return (
      <Modal open onClose={onClose} title={title} wide>
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-semibold text-green-700">{ok.length} imported</span>
            {failed.length > 0 && <> · <span className="font-semibold text-red-700">{failed.length} failed</span></>}.
          </p>
          {failed.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-red-100 bg-red-50/50">
              <table className="w-full text-left text-xs">
                <thead className="text-red-700"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Name</th><th className="px-2 py-1">Error</th></tr></thead>
                <tbody>
                  {failed.map((r) => (
                    <tr key={r.line} className="border-t border-red-100">
                      <td className="px-2 py-1 tabular-nums">{r.line}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1 text-red-700">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setResults(null); setProgress(null); setRaw(''); }}>Import more</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Input + preview view ──────────────────────────────────────────────────
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={title} wide>
      <div className="space-y-4">
        <div className="rounded-md bg-watch-50 px-3 py-2 text-xs text-slate-600">
          <p>Paste rows (or upload a <code>.csv</code>). A header row is recognized automatically; otherwise columns are read in this order:</p>
          <p className="mt-1 font-mono text-[11px] text-watch-800">{headerLine}</p>
          <p className="mt-1">Required: {columns.filter((c) => c.required).map((c) => c.label).join(', ') || 'none'}. Example: <span className="font-mono text-[11px]">{exampleRow}</span></p>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          disabled={busy}
          placeholder={`${headerLine}\n${exampleRow}`}
          className="w-full rounded-md border border-watch-200 px-3 py-2 font-mono text-xs focus:border-bifrost-400 focus:outline-none focus:ring-1 focus:ring-bifrost-300"
        />
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} className="hidden" />
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Upload CSV file…</Button>
        </div>

        {parsed.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-md border border-watch-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-watch-50 text-watch-600">
                <tr>
                  <th className="px-2 py-1">#</th>
                  {columns.map((c) => <th key={c.key} className="px-2 py-1">{c.label}</th>)}
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.line} className={`border-t border-watch-50 ${p.errors.length ? 'bg-red-50/40' : ''}`}>
                    <td className="px-2 py-1 tabular-nums text-slate-400">{p.line}</td>
                    {columns.map((c) => <td key={c.key} className="px-2 py-1">{p.record[c.key] || <span className="text-slate-300">—</span>}</td>)}
                    <td className="px-2 py-1">
                      {p.errors.length === 0
                        ? <span className="text-green-700">✓</span>
                        : <span className="text-red-700" title={p.errors.join('\n')}>⚠ {p.errors.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {parsed.length > 0 && (
          <p className="text-sm text-slate-600">
            <strong>{valid.length}</strong> ready to import{invalid.length > 0 && <> · <span className="text-red-700">{invalid.length} skipped (fix the rows above)</span></>}.
          </p>
        )}
        {confirmNote && valid.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{confirmNote}</p>}
        {progress && <p className="text-sm text-slate-600">Importing {progress.done}/{progress.total}…</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={runImport} disabled={busy || valid.length === 0}>
            {busy ? 'Importing…' : `Import ${valid.length || ''} ${valid.length === 1 ? 'row' : 'rows'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
