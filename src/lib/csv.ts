/** Tiny CSV helpers (RFC 4180-style quoting + parsing). */

/**
 * Parse CSV text into rows of cells. Handles quoted fields, escaped quotes (""),
 * commas and newlines inside quotes, and CRLF/CR/LF line endings. Fully-blank
 * rows are dropped. Cells are returned untrimmed (callers trim as needed).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    let s = v == null ? '' : String(v);
    // Neutralize spreadsheet formula injection: a field beginning with = + - @
    // (or a control char) is executed as a formula by Excel/Sheets.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
