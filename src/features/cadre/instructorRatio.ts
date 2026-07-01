/**
 * FDLE instructor-ratio helpers. CJSTC expects a minimum number of instructors per
 * student for many courses (especially high-liability ones) — one instructor per
 * `ratio` students. The requirement is derived read-time from the curriculum so a
 * day can show whether it's adequately staffed. It is NOT hard-enforced: lighter
 * days (lecture, review, partial cohorts) legitimately run leaner, so this drives
 * an advisory badge, not a block.
 */
import type { SlotRole } from '../../types';

/** Roles that count as instruction toward the ratio (coordinators/role-players don't). */
const INSTRUCTOR_ROLES: SlotRole[] = ['lead', 'assistant', 'safety_officer'];

type SlotLike = { role: SlotRole; count: number; filledBy?: string[] };

/** Instructors required for a class of `classSize` at 1:`ratio`. 0 when not applicable. */
export function requiredInstructors(ratio: number | undefined, classSize: number): number {
  return ratio && ratio > 0 && classSize > 0 ? Math.ceil(classSize / ratio) : 0;
}

/**
 * Count instructor slots — `planned` (slot capacity, for designing a session) or
 * `filled` (instructors actually signed up, for "is this day staffed?"). Excludes
 * coordinators and role-players.
 */
export function instructorCount(slots: SlotLike[] = [], mode: 'planned' | 'filled'): number {
  return slots
    .filter((s) => INSTRUCTOR_ROLES.includes(s.role))
    // 'filled' counts real people present (legacy over-filled slots included) —
    // clamping to slot capacity undercounted actual staffing.
    .reduce((n, s) => n + (mode === 'filled' ? (s.filledBy?.length ?? 0) : s.count), 0);
}
