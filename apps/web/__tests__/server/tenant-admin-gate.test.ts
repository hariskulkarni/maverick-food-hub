/**
 * P1-5 / P1-4: admin-only gates are MEMBERSHIP-role aware. A global ADMIN who
 * only holds a KITCHEN grant on the active restaurant is KITCHEN there; a
 * KITCHEN member never passes requireTenantAdmin / requireRestaurantAdminApi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  memberships: [] as any[],
  owned: [] as any[],
  cookie: undefined as string | undefined,
}));

vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }),
}));
vi.mock('@/server/db', () => ({
  prisma: {
    restaurantUser: { findMany: async () => h.memberships },
    restaurant: {
      findMany: async ({ where }: any) => (where.ownerUserId ? h.owned : []),
      findUnique: async ({ where }: any) => ({ id: where.id, name: 'Any' }),
    },
  },
}));

import { requireTenantAdmin, activeMembership, requireManagedRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';

const R = (id: string) => ({ id, name: id, parentId: null });

beforeEach(() => {
  h.memberships = [];
  h.owned = [];
  h.cookie = undefined;
});

describe('requireTenantAdmin', () => {
  it('passes for an ADMIN member of the active restaurant', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    h.memberships = [{ restaurantId: 'A', role: 'ADMIN', restaurant: R('A') }];
    await expect(requireTenantAdmin()).resolves.toMatchObject({ id: 'A' });
  });

  it('403s a global ADMIN whose grant on the ACTIVE restaurant is KITCHEN', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    h.memberships = [
      { restaurantId: 'A', role: 'ADMIN', restaurant: R('A') },
      { restaurantId: 'B', role: 'KITCHEN', restaurant: R('B') },
    ];
    h.cookie = 'B';
    expect((await activeMembership())?.role).toBe('KITCHEN');
    const err = await requireTenantAdmin().catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(403);
  });

  it('403s a KITCHEN user', async () => {
    h.auth.mockResolvedValue({ user: { id: 'k1', role: 'KITCHEN' } });
    h.memberships = [{ restaurantId: 'A', role: 'KITCHEN', restaurant: R('A') }];
    const err = await requireTenantAdmin().catch((e) => e);
    expect(err.status).toBe(403);
  });

  it('401s without a session, 403s a customer', async () => {
    h.auth.mockResolvedValue(null);
    expect((await requireTenantAdmin().catch((e) => e)).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: 'c', role: 'CUSTOMER' } });
    expect((await requireTenantAdmin().catch((e) => e)).status).toBe(403);
  });

  it('lets SUPER_ADMIN target an explicit restaurant only', async () => {
    h.auth.mockResolvedValue({ user: { id: 's', role: 'SUPER_ADMIN' } });
    await expect(requireTenantAdmin('X')).resolves.toMatchObject({ id: 'X' });
    expect((await requireTenantAdmin().catch((e) => e)).status).toBe(403);
  });
});

describe('requireManagedRestaurant', () => {
  it('honours an explicit restaurantId only for SUPER_ADMIN', async () => {
    h.auth.mockResolvedValue({ user: { id: 's', role: 'SUPER_ADMIN' } });
    await expect(requireManagedRestaurant('X')).resolves.toMatchObject({ id: 'X' });
  });

  it('ignores a caller-supplied restaurantId for a tenant ADMIN (stays on their own restaurant)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    h.memberships = [{ restaurantId: 'A', role: 'ADMIN', restaurant: R('A') }];
    await expect(requireManagedRestaurant('X')).resolves.toMatchObject({ id: 'A' });
    await expect(requireManagedRestaurant()).resolves.toMatchObject({ id: 'A' });
  });

  it('404s a signed-out caller even when a restaurantId is supplied', async () => {
    h.auth.mockResolvedValue(null);
    const err = await requireManagedRestaurant('X').catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(404);
  });
});

describe('requireRestaurantAdminApi (membership aware)', () => {
  it('returns 403 for a global ADMIN acting in a restaurant where they are KITCHEN', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    h.memberships = [{ restaurantId: 'B', role: 'KITCHEN', restaurant: R('B') }];
    const res = await requireRestaurantAdminApi();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('returns the session for an ADMIN member', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    h.memberships = [{ restaurantId: 'A', role: 'ADMIN', restaurant: R('A') }];
    const res = await requireRestaurantAdminApi();
    expect(res).not.toBeInstanceOf(Response);
  });

  it('owners are ADMIN even without a grant row', async () => {
    h.auth.mockResolvedValue({ user: { id: 'o1', role: 'ADMIN' } });
    h.owned = [R('A')];
    expect(await requireRestaurantAdminApi()).not.toBeInstanceOf(Response);
  });
});
