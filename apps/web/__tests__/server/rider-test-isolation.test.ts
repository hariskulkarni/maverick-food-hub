/**
 * Pre-launch test isolation — the ONE rule every dispatch path shares
 * (rider-sourcing.testIsolationAllows / riderTestSideFilter): test riders only
 * ever get test-customer orders and real riders never get test orders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  order: null as any,
  riderWhere: null as any,
  riderFindMany: vi.fn(),
}));
vi.mock('@/server/db', () => ({
  prisma: {
    order: { findUnique: async () => h.order },
    riderProfile: { findMany: (args: any) => { h.riderWhere = args.where; return h.riderFindMany(args); } },
  },
}));
vi.mock('@/server/group-scope', () => ({ resolveGroupContext: async (id: string) => ({ restaurantIds: [id] }) }));

import {
  testIsolationAllows,
  riderTestSideFilter,
  riderCanClaimOrder,
  filterOrdersForRider,
  targetRidersForNewOrder,
} from '@/server/rider-sourcing';

const order = (test: boolean, id = 'o') => ({
  id,
  readyAt: new Date(0),
  customer: { isTestAccount: test },
  branch: { restaurant: { id: 'r1', riderDispatchMode: 'FLEET_ONLY' as any, fleetFallbackMinutes: 10 } },
});
const rider = (isTestAccount: boolean) => ({ id: 'rp', riderType: 'FLEET' as any, dedicatedRestaurantId: null, isTestAccount });

beforeEach(() => {
  h.riderFindMany.mockReset().mockResolvedValue([{ expoPushToken: 'tok' }]);
  h.riderWhere = null;
});

describe('test isolation rule', () => {
  it('matches only same-side pairs', () => {
    expect(testIsolationAllows(false, order(false))).toBe(true);
    expect(testIsolationAllows(true, order(true))).toBe(true);
    expect(testIsolationAllows(true, order(false))).toBe(false);
    expect(testIsolationAllows(false, order(true))).toBe(false);
    expect(testIsolationAllows(false, { customer: null })).toBe(true);
  });

  it('riderCanClaimOrder / filterOrdersForRider enforce it before dispatch policy', () => {
    expect(riderCanClaimOrder(rider(true), order(false))).toBe(false);
    expect(riderCanClaimOrder(rider(false), order(true))).toBe(false);
    expect(riderCanClaimOrder(rider(true), order(true))).toBe(true);
    const list = [order(false, 'real'), order(true, 'test')];
    expect(filterOrdersForRider(rider(true), list).map((o) => o.id)).toEqual(['test']);
    expect(filterOrdersForRider(rider(false), list).map((o) => o.id)).toEqual(['real']);
  });

  it('DB filter mirrors the predicate', () => {
    expect(riderTestSideFilter(order(true))).toEqual({ user: { isTestAccount: true } });
    expect(riderTestSideFilter(order(false))).toEqual({ user: { isTestAccount: false } });
  });

  it('new-order push only targets riders on the order side', async () => {
    h.order = { customer: { isTestAccount: false }, branch: { restaurant: { id: 'r1', riderDispatchMode: 'FLEET_ONLY' } } };
    await targetRidersForNewOrder('o1');
    expect(h.riderWhere.user).toEqual({ isTestAccount: false });
    h.order = { customer: { isTestAccount: true }, branch: { restaurant: { id: 'r1', riderDispatchMode: 'FLEET_ONLY' } } };
    await targetRidersForNewOrder('o2');
    expect(h.riderWhere.user).toEqual({ isTestAccount: true });
  });
});
