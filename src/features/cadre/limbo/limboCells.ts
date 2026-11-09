/**
 * Pure date / patch helpers for the Limbo tracker's plan doc
 * (academies/{id}/limbo/plan — cells[memberId][yyyy-mm-dd] = activity label).
 * Kept free of Firebase so the write-shape rules below are unit-testable.
 */
import { addDays, toDateInputValue } from '../../../lib/time';

/** yyyy-mm-dd → local midnight (never `new Date('yyyy-mm-dd')`, which is UTC). */
export const localDate = (s: string) => new Date(`${s}T00:00:00`);
export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Calendar days from..to INCLUSIVE; 0 when reversed or either date is blank/invalid. DST-safe (rounded). */
export function daySpan(fromKey: string, toKey: string): number {
  const from = localDate(fromKey).getTime();
  const to = localDate(toKey).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.round((to - from) / 864e5) + 1;
}

/** Every yyyy-mm-dd key from..to inclusive, optionally skipping Sat/Sun. */
export function dayKeysInRange(fromKey: string, toKey: string, weekdaysOnly: boolean): string[] {
  const out: string[] = [];
  const span = daySpan(fromKey, toKey);
  let d = localDate(fromKey);
  for (let i = 0; i < span; i += 1, d = addDays(d, 1)) {
    if (weekdaysOnly && isWeekend(d)) continue;
    out.push(toDateInputValue(d));
  }
  return out;
}

/** cells patch that sets `value` for every listed cadet on every listed day. */
export function bulkCellPatch<V>(memberIds: Iterable<string>, dayKeys: string[], value: V): Record<string, Record<string, V>> {
  const patch: Record<string, Record<string, V>> = {};
  if (dayKeys.length === 0) return patch;
  for (const id of memberIds) {
    const row: Record<string, V> = {};
    for (const key of dayKeys) row[key] = value;
    patch[id] = row;
  }
  return patch;
}

/**
 * Strips cadet rows that carry no day, and returns undefined when nothing is
 * left. REQUIRED before any `setDoc(..., { merge: true })`: the SDK puts an
 * EMPTY map into the update mask as a whole-field overwrite, so `cells: {}`
 * erases every cadet's plan and `cells: { [id]: {} }` erases that cadet's row —
 * the opposite of "nothing to write".
 */
export function nonEmptyCells<V>(cells: Record<string, Record<string, V>> | undefined): Record<string, Record<string, V>> | undefined {
  if (!cells) return undefined;
  const kept = Object.entries(cells).filter(([, row]) => row && Object.keys(row).length > 0);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
