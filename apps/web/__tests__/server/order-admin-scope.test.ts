/**
 * C12 — admin order routes must be tenant-scoped. The shared guard confirms an
 * order belongs to the caller's restaurant (SUPER_ADMIN spans all tenants).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let restaurant: any;
let ordersById: Record<string, { restaurantId: string }> = {};

vi.mock('@/server/api-auth', () => ({ requireAnyAdminApi: async () => session }));
vi.mock('@/server/tenancy', () => ({ currentRestaurant: async () => restaurant }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: {
      findFirst: async ({ where }: any) => {
        const row = ordersById[where.id];
        if (!row) return null;
        // emulate the branch.restaurantId predicate
        if (where.branch?.restaurantId && where.branch.restaurantId !== row.restaurantId) return null;
        return { id: where.id };
      }
    }
  }
}));

import { requireOwnedOrder, requireOrderAdminScope } from '@/app/api/admin/orders/_helpers';

beforeEach(() => {
  session = { user: { id: 'u1', role: 'ADMIN' } };
  restaurant = { id: 'A' };
  ordersById = { oA: { restaurantId: 'A' }, oB: { restaurantId: 'B' } };
});

describe('C12: order admin tenant scope', () => {
  it('ADMIN at A can act on an A order', async () => {
    const r = await requireOwnedOrder('oA');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.scopeRestaurantId).toBe('A');
  });

  it('ADMIN at A gets 404 for a B order', async () => {
    const r: any = await requireOwnedOrder('oB');
    expect('error' in r).toBe(true);
    expect(r.error.status).toBe(404);
  });

  it('SUPER_ADMIN spans all tenants (scope null, any order)', async () => {
    session = { user: { id: 'su', role: 'SUPER_ADMIN' } };
    const r = await requireOwnedOrder('oB');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.scopeRestaurantId).toBeNull();
  });

  it('ADMIN with no restaurant is refused', async () => {
    restaurant = null;
    const r: any = await requireOrderAdminScope();
    expect('error' in r).toBe(true);
    expect(r.error.status).toBe(404);
  });
});
