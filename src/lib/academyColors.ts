/**
 * A small, fixed palette of academy colors. Each academy can be assigned one
 * so its sessions read as a consistent color band across the calendar,
 * distinguishing concurrent cohorts (e.g. LE 131 vs LE 132) at a glance.
 * All chosen to carry white text and stay legible side-by-side.
 */
export interface AcademyColor {
  name: string;
  value: string;
}

export const ACADEMY_COLORS: AcademyColor[] = [
  { name: 'Navy', value: '#1f2a45' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Indigo', value: '#4338ca' },
  { name: 'Burgundy', value: '#9f1239' },
  { name: 'Forest', value: '#166534' },
  { name: 'Slate', value: '#475569' },
  { name: 'Plum', value: '#7e22ce' },
  { name: 'Bronze', value: '#92400e' },
];

export const DEFAULT_ACADEMY_COLOR = ACADEMY_COLORS[0].value;

export function academyColorFor(academy?: { color?: string } | null): string {
  return academy?.color || DEFAULT_ACADEMY_COLOR;
}

/** Pick the first palette color not already used by another academy. */
export function nextAcademyColor(used: string[]): string {
  const free = ACADEMY_COLORS.find((c) => !used.includes(c.value));
  return (free ?? ACADEMY_COLORS[0]).value;
}
