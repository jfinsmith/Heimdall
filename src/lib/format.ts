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
