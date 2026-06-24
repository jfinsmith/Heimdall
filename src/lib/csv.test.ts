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
