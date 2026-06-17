/**
 * Roster module registry — the single source for which tabs a discipline's
 * roster can show, and their labels. `Members` is always present and is not in
 * this list. Adding a new module (e.g. a discipline-specific attendance variant
 * with its own PDF) is a one-line entry here plus a render branch in RosterPage.
 *
 * Attendance is intentionally per-discipline: each variant carries its own
 * `attendanceFormat` so its printable roster can differ. Only 'le' is built so
 * far; the others are listed as `comingSoon` so the structure is visible in the
 * admin picker but can't be enabled until their print format exists.
 */
import type { RosterModuleKey } from '../../../types';

export interface RosterModuleDef {
  key: RosterModuleKey;
  label: string;
  /** Attendance modules carry a print-format id; other modules omit it. */
  attendanceFormat?: 'le' | 'co' | 'argus' | 'nmt';
  /** Listed in the admin picker but not yet renderable (no print format built). */
  comingSoon?: boolean;
}

export const ROSTER_MODULES: RosterModuleDef[] = [
  { key: 'le_attendance', label: 'LE Attendance', attendanceFormat: 'le' },
  { key: 'co_attendance', label: 'CO Attendance', attendanceFormat: 'co', comingSoon: true },
  { key: 'argus_attendance', label: 'ARGUS Attendance', attendanceFormat: 'argus', comingSoon: true },
  { key: 'nmt_attendance', label: 'NMT Attendance', attendanceFormat: 'nmt', comingSoon: true },
  { key: 'discipline', label: 'Discipline' },
  { key: 'grades', label: 'Gradebook' },
  { key: 'reports', label: 'Reports' },
];

export const ROSTER_MODULE_BY_KEY: Record<RosterModuleKey, RosterModuleDef> = Object.fromEntries(
  ROSTER_MODULES.map((m) => [m.key, m])
) as Record<RosterModuleKey, RosterModuleDef>;

/** Default modules when a discipline hasn't been configured — today's full LE set (back-compat). */
export const DEFAULT_ROSTER_MODULES: RosterModuleKey[] = ['le_attendance', 'discipline', 'grades', 'reports'];

/** The modules to actually show for a curriculum, in registry order, skipping unbuilt ones. */
export function enabledRosterModules(rosterModules: RosterModuleKey[] | undefined): RosterModuleDef[] {
  const enabled = new Set(rosterModules ?? DEFAULT_ROSTER_MODULES);
  return ROSTER_MODULES.filter((m) => enabled.has(m.key) && !m.comingSoon);
}
