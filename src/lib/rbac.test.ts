/** The rank ladder the UI uses — must mirror assertMayActOn on the server. */
import { describe, it, expect } from 'vitest';
import { can, isTopAdmin, mayActOn, mayAssignRole, PERMISSION_MATRIX, RANKS, RANK_ORDER_ASC, CHAIN_OF_COMMAND } from './rbac';
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
