/** The rank ladder the UI uses — must mirror assertMayActOn on the server. */
import { describe, it, expect } from 'vitest';
import { can, isTopAdmin, mayActOn, mayAssignRole, mayDeleteAcademy, PERMISSION_MATRIX, RANKS, RANK_ORDER_ASC, CHAIN_OF_COMMAND } from './rbac';
import type { Role } from '../types';

const ROLES: Role[] = ['guest', 'instructor', 'coordinator', 'sergeant', 'lieutenant', 'director'];

describe('lieutenant == director, everywhere', () => {
  it('every capability gate answers the same for both', () => {
    for (const gate of Object.values(can)) expect(gate('lieutenant')).toBe(gate('director'));
    expect(isTopAdmin('lieutenant')).toBe(true);
    expect(isTopAdmin('director')).toBe(true);
  });
  it('each may act on, and assign, every role — including each other and themselves', () => {
    for (const top of ['lieutenant', 'director'] as Role[]) {
      for (const r of ROLES) {
        expect(mayActOn(top, r)).toBe(true);
        expect(mayAssignRole(top, r)).toBe(true);
      }
    }
  });
  it('anyone else sees them as the same rank', () => {
    for (const r of ROLES) {
      expect(mayActOn(r, 'lieutenant')).toBe(mayActOn(r, 'director'));
      expect(mayAssignRole(r, 'lieutenant')).toBe(mayAssignRole(r, 'director'));
    }
  });
  it('the documented permission matrix never separates them', () => {
    for (const row of PERMISSION_MATRIX) expect(row.roles.lieutenant, row.capability).toBe(row.roles.director);
  });
});

describe('deleting an academy: sergeant and above, or the coordinator who created it', () => {
  const mine = { createdBy: 'me' };
  const theirs = { createdBy: 'someone-else' };
  it('sergeant, lieutenant and director delete any class', () => {
    for (const r of ['sergeant', 'lieutenant', 'director'] as Role[]) {
      expect(mayDeleteAcademy(r, 'me', theirs)).toBe(true);
      expect(mayDeleteAcademy(r, 'me', {})).toBe(true);
    }
  });
  it('a coordinator deletes only a class they created', () => {
    expect(mayDeleteAcademy('coordinator', 'me', mine)).toBe(true);
    expect(mayDeleteAcademy('coordinator', 'me', theirs)).toBe(false);
    expect(mayDeleteAcademy('coordinator', 'me', {})).toBe(false); // no creator on file
    expect(mayDeleteAcademy('coordinator', null, mine)).toBe(false);
    expect(mayDeleteAcademy('coordinator', '', { createdBy: '' })).toBe(false);
  });
  it('instructors and guests never delete, even a class stamped with their uid', () => {
    expect(mayDeleteAcademy('instructor', 'me', mine)).toBe(false);
    expect(mayDeleteAcademy('guest', 'me', mine)).toBe(false);
    expect(mayDeleteAcademy(null, 'me', mine)).toBe(false);
  });
});

describe('below the top: strictly lower rank only', () => {
  it('a sergeant acts on coordinator and below — never a peer or a superior', () => {
    expect(['guest', 'instructor', 'coordinator'].every((r) => mayActOn('sergeant', r as Role))).toBe(true);
    expect(mayActOn('sergeant', 'sergeant')).toBe(false);
    expect(mayActOn('sergeant', 'lieutenant')).toBe(false);
    expect(mayActOn('sergeant', 'director')).toBe(false);
  });
  it('a sergeant cannot hand out their own rank or higher', () => {
    expect(mayAssignRole('sergeant', 'coordinator')).toBe(true);
    expect(mayAssignRole('sergeant', 'sergeant')).toBe(false);
    expect(mayAssignRole('sergeant', 'director')).toBe(false);
  });
  it('a role-less target (pending join) ranks lowest; a role-less caller can do nothing', () => {
    expect(mayActOn('sergeant', null)).toBe(true);
    expect(mayActOn('sergeant', undefined)).toBe(true);
    for (const r of ROLES) {
      expect(mayActOn(null, r)).toBe(false);
      expect(mayAssignRole(undefined, r)).toBe(false);
    }
  });
});

describe('capability gates', () => {
  it('staff = coordinator and up; admin = sergeant and up', () => {
    expect(ROLES.filter((r) => can.buildSchedules(r))).toEqual(['coordinator', 'sergeant', 'lieutenant', 'director']);
    expect(ROLES.filter((r) => can.manageOrg(r))).toEqual(['sergeant', 'lieutenant', 'director']);
    expect(can.buildSchedules(null)).toBe(false);
    expect(can.manageOrg(undefined)).toBe(false);
  });
  it('everyone but a guest (or a role-less account) may sign up', () => {
    expect(ROLES.filter((r) => can.signUp(r))).toEqual(['instructor', 'coordinator', 'sergeant', 'lieutenant', 'director']);
    expect(can.signUp(null)).toBe(false);
  });
  it('the rank registry covers every role once, lowest first', () => {
    expect(RANK_ORDER_ASC).toEqual(ROLES);
    expect(CHAIN_OF_COMMAND).toEqual([...ROLES].reverse());
    expect(new Set(RANKS.map((r) => r.key)).size).toBe(ROLES.length);
  });
});

describe('viewer — read-only, outside the ranks', () => {
  it('has no capability except its own Staffing page', () => {
    for (const [name, gate] of Object.entries(can)) {
      expect((gate as (r: Role) => boolean)('viewer'), name).toBe(name === 'viewViewerPage');
    }
    expect(can.viewViewerPage('director')).toBe(false);
    expect(can.viewViewerPage('director', true)).toBe(true); // platform owner preview
    expect(mayDeleteAcademy('viewer', 'v1', { createdBy: 'v1' })).toBe(false);
  });
  it('no role — not even a top admin — can assign it from the app', () => {
    for (const r of ROLES) expect(mayAssignRole(r, 'viewer'), r).toBe(false);
  });
  it('is not a rank: absent from rank order, chain of command and the rank list', () => {
    expect(RANK_ORDER_ASC).not.toContain('viewer');
    expect(CHAIN_OF_COMMAND).not.toContain('viewer');
    expect(RANKS.map((r) => r.key)).not.toContain('viewer');
  });
  it('the permission matrix grants it only the Staffing page', () => {
    for (const row of PERMISSION_MATRIX) expect(row.roles.viewer, row.capability).toBe(row.capability.startsWith('Read-only Staffing page'));
  });
  it('adding it changed nothing for the existing roles', () => {
    for (const r of ROLES) {
      expect(can.signUp(r)).toBe(r !== 'guest');
      expect(mayActOn('sergeant', r)).toBe(['guest', 'instructor', 'coordinator'].includes(r));
    }
  });
});
