import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('handles quoted fields with embedded commas and escaped quotes', () => {
    expect(parseCsv('name,note\n"Smith, J","said ""hi"""')).toEqual([['name', 'note'], ['Smith, J', 'said "hi"']]);
  });
  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a\n"line1\nline2",b')).toEqual([['a'], ['line1\nline2', 'b']]);
  });
  it('normalizes CRLF and drops fully-blank rows', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips data through toCsv', () => {
    const headers = ['name', 'note'];
    const rows = [['Smith, J', 'a "quote"'], ['Doe', 'plain']];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows]);
  });
});

describe('toCsv', () => {
  it('neutralizes spreadsheet formulas in text cells (= + - @ tab CR)', () => {
    const out = toCsv(['v'], [['=HYPERLINK("http://x","y")'], ['+1 813 555 0100'], ['-cmd'], ['@SUM(A1)'], ['\tx']]);
    expect(out.split('\n').slice(1)).toEqual([`"'=HYPERLINK(""http://x"",""y"")"`, `'+1 813 555 0100`, `'-cmd`, `'@SUM(A1)`, `'\tx`]);
  });
  it('keeps real numbers numeric — a negative number is not a formula', () => {
    expect(toCsv(['hours'], [[-1.5], [8], [0]])).toBe('hours\n-1.5\n8\n0');
  });
  it('renders null/undefined as empty and booleans as words', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, true]])).toBe('a,b,c\n,,true');
  });
  it('quotes a cell holding a bare carriage return so it cannot split the row', () => {
    const out = toCsv(['note'], [['line1\rline2']]);
    expect(out).toBe('note\n"line1\rline2"');
  });
});
