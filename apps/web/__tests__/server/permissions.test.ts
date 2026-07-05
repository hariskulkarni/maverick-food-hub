import { describe, it, expect } from 'vitest';
import {
  can,
  canAny,
  capabilitiesFor,
  isPlatformRole,
  isConfidential,
  pageGateFor,
  ALL_CAPABILITIES,
  PLATFORM_ROLES,
  ASSIGNABLE_PLATFORM_ROLES,
  CONFIDENTIAL_CAPABILITIES,
  ROLE_CAPABILITIES,
} from '@/server/permissions';
import type { Role } from '@prisma/client';

describe('IAM capability matrix', () => {
  it('SUPER_ADMIN holds every capability', () => {
    for (const c of ALL_CAPABILITIES) expect(can('SUPER_ADMIN', c)).toBe(true);
  });

  it('DEVELOPER can only touch the CMS (+ restaurants read)', () => {
    expect(can('DEVELOPER', 'cms:write')).toBe(true);
    expect(can('DEVELOPER', 'restaurants:read')).toBe(true);
    expect(can('DEVELOPER', 'ops:read')).toBe(false);
    expect(can('DEVELOPER', 'finance:read')).toBe(false);
    expect(can('DEVELOPER', 'iam:manage')).toBe(false);
  });

  it('ADMIN_ASSIST runs ops + riders but NOT confidential ops', () => {
    expect(can('ADMIN_ASSIST', 'riders:write')).toBe(true);
    expect(can('ADMIN_ASSIST', 'ops:write')).toBe(true);
    expect(can('ADMIN_ASSIST', 'finance:write')).toBe(false);
    expect(can('ADMIN_ASSIST', 'restaurants:write')).toBe(false);
    expect(can('ADMIN_ASSIST', 'iam:manage')).toBe(false);
    expect(can('ADMIN_ASSIST', 'platform:admin')).toBe(false);
  });

  it('QA is read-everything + test, never write', () => {
    expect(can('QA', 'riders:read')).toBe(true);
    expect(can('QA', 'ops:read')).toBe(true);
    expect(can('QA', 'qa:test')).toBe(true);
    expect(can('QA', 'riders:write')).toBe(false);
    expect(can('QA', 'cms:write')).toBe(false);
    expect(can('QA', 'finance:read')).toBe(false);
  });

  it('GUEST is strictly read-only', () => {
    expect(can('GUEST', 'ops:read')).toBe(true);
    expect(can('GUEST', 'cms:read')).toBe(true);
    expect(can('GUEST', 'ops:write')).toBe(false);
    expect(can('GUEST', 'qa:test')).toBe(false);
    expect(can('GUEST', 'iam:manage')).toBe(false);
  });

  it('non-platform roles get no console capabilities', () => {
    for (const r of ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER'] as Role[]) {
      expect(isPlatformRole(r)).toBe(false);
      expect(capabilitiesFor(r)).toEqual([]);
      expect(can(r, 'platform:view')).toBe(false);
    }
  });

  it('unknown / null roles deny by default', () => {
    expect(can(null, 'platform:view')).toBe(false);
    expect(can(undefined, 'cms:read')).toBe(false);
    expect(can('NONSENSE', 'platform:view')).toBe(false);
  });

  it('only the five platform roles may open the console', () => {
    expect([...PLATFORM_ROLES].sort()).toEqual(
      ['ADMIN_ASSIST', 'DEVELOPER', 'GUEST', 'QA', 'SUPER_ADMIN'],
    );
  });

  it('IAM can assign exactly the four delegated roles (never SUPER_ADMIN)', () => {
    expect([...(ASSIGNABLE_PLATFORM_ROLES as unknown as string[])].sort()).toEqual(
      ['ADMIN_ASSIST', 'DEVELOPER', 'GUEST', 'QA'],
    );
    expect((ASSIGNABLE_PLATFORM_ROLES as unknown as string[])).not.toContain('SUPER_ADMIN');
  });

  it('no delegated role holds any confidential capability', () => {
    for (const r of ['ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST'] as Role[]) {
      for (const c of CONFIDENTIAL_CAPABILITIES) expect(can(r, c)).toBe(false);
    }
  });

  it('confidential set = iam:manage, finance:write, restaurants:write', () => {
    expect([...CONFIDENTIAL_CAPABILITIES].sort()).toEqual(
      ['finance:write', 'iam:manage', 'restaurants:write'],
    );
    expect(isConfidential('finance:write')).toBe(true);
    expect(isConfidential('cms:write')).toBe(false);
  });

  it('canAny works', () => {
    expect(canAny('QA', ['ops:write', 'ops:read'])).toBe(true);
    expect(canAny('GUEST', ['ops:write', 'cms:write'])).toBe(false);
  });

  it('every Role has a capability entry (exhaustive matrix)', () => {
    for (const r of ['CUSTOMER','ADMIN','KITCHEN','RIDER','SUPER_ADMIN','ADMIN_ASSIST','DEVELOPER','QA','GUEST'] as Role[]) {
      expect(ROLE_CAPABILITIES[r]).toBeInstanceOf(Set);
    }
  });
});

describe('platform page gates (longest-prefix routing)', () => {
  const cases: Array<[string, string]> = [
    ['/platform', 'platform:view'],
    ['/platform/iam', 'iam:manage'],
    ['/platform/users', 'platform:admin'],
    ['/platform/qr', 'platform:admin'],
    ['/platform/payouts', 'finance:read'],
    ['/platform/rider-payouts', 'finance:read'], // NOT riders:read — specific wins
    ['/platform/rider-shifts', 'riders:read'],
    ['/platform/discovery-cms', 'cms:read'],
    ['/platform/live-ops', 'ops:read'],
    ['/platform/restaurants', 'restaurants:read'],
    ['/platform/restaurants/abc123', 'restaurants:read'], // nested path
  ];
  for (const [path, cap] of cases) {
    it(`${path} → ${cap}`, () => expect(pageGateFor(path)).toBe(cap));
  }

  it('gate access matches capability for each role', () => {
    // A GUEST may open discovery-cms (cms:read) but not payouts (finance:read)
    expect(can('GUEST', pageGateFor('/platform/discovery-cms'))).toBe(true);
    expect(can('GUEST', pageGateFor('/platform/payouts'))).toBe(false);
    // A DEVELOPER cannot open ops
    expect(can('DEVELOPER', pageGateFor('/platform/orders'))).toBe(false);
    // ADMIN_ASSIST can open riders + ops, not IAM
    expect(can('ADMIN_ASSIST', pageGateFor('/platform/rider-shifts'))).toBe(true);
    expect(can('ADMIN_ASSIST', pageGateFor('/platform/iam'))).toBe(false);
  });
});
