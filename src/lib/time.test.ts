/** Unit tests for the session-duration guard used across all create/edit paths. */
import { describe, it, expect } from 'vitest';
import { isValidDuration } from './time';

const at = (h: number, m = 0) => new Date(2026, 5, 1, h, m, 0);

describe('isValidDuration', () => {
  it('accepts a normal positive span', () => {
    expect(isValidDuration(at(8), at(16))).toBe(true);
  });

  it('accepts a one-minute span', () => {
    expect(isValidDuration(at(8, 0), at(8, 1))).toBe(true);
  });

  it('rejects a zero-length span (end === start) — the FullCalendar null-end crash case', () => {
    expect(isValidDuration(at(8), at(8))).toBe(false);
  });

  it('rejects an inverted span (end before start)', () => {
    expect(isValidDuration(at(16), at(8))).toBe(false);
  });
});
