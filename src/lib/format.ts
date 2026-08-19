/**
 * Phone-number formatting. Coerces any input to the canonical (###)###-#### form,
 * regardless of how it was typed (spaces, dots, dashes, "+1", etc.). Idempotent:
 * a value already in canonical form re-formats to itself.
 *
 * Non-standard input (not a 10-digit US number, or 11 digits with a leading
 * country-code "1") is returned trimmed-but-otherwise-unchanged, so we never
 * silently corrupt extensions, partials, or international numbers.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}

/**
 * Heuristic first/last split of a legacy display name: last token is the last
 * name, with generational suffixes (Jr., Sr., II–V) kept attached to it.
 * Used to seed firstName/lastName for accounts that predate the split fields
 * (scripts/backfill-names.ts and prefills) — admins correct oddballs by hand.
 */
export function splitDisplayName(name: string): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  let lastIdx = parts.length - 1;
  if (/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[lastIdx]) && parts.length >= 3) lastIdx -= 1;
  return { firstName: parts.slice(0, lastIdx).join(' '), lastName: parts.slice(lastIdx).join(' ') };
}
