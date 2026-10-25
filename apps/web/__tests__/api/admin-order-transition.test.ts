/**
 * P0-3 / P1-11: the staff transition route only accepts operational targets,
 * and a restaurant cancellation of a captured order queues REFUND_PENDING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  order: { status: 'RECEIVED', fulfillmentType: 'DELIVERY' } as any,
  role: 'ADMIN' as string,
  captured: null as any,
  transitionOrder: vi.fn(),
  orderUpdate: vi.fn(),
}));

vi.mock('@/app/api/admin/orders/_helpers', () => ({
  requireOwnedOrder: async () => ({ session: { user: { id: 'u1', role: 'ADMIN' } }, scopeRestaurantId: 'A' }),
  orderScopeWhere: (id: string, r: string) => ({ id, branch: { restaurantId: r } }),
}));
vi.mock('@/server/tenancy', () => ({ activeMembership: async () => ({ role: h.role, restaurant: { id: 'A' }, userId: 'u1' }) }));
vi.mock('@/server/orders', () => {
  class OrderTransitionError extends Error {}
  return { transitionOrder: h.transitionOrder, OrderTransitionError };
});
vi.mock('@/server/db', () => ({
  prisma: {
    order: {
      findFirst: async () => h.order,
      update: h.orderUpdate,
      findUniqueOrThrow: async () => ({ id: 'o1', code: 'C1', status: 'REFUND_PENDING' }),
    },
    payment: { findFirst: async () => h.captured },
  },
}));

import { POST } from '@/app/api/admin/orders/[id]/transition/route';

const call = (status: string, note?: string) =>
  POST({ json: async () => ({ status, note }) } as any, { params: Promise.resolve({ id: 'o1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.order = { status: 'RECEIVED', fulfillmentType: 'DELIVERY' };
  h.role = 'ADMIN';
  h.captured = null;
  h.transitionOrder.mockImplementation(async (_id: string, next: string) => ({ id: 'o1', code: 'C1', status: next, customer: { passwordHash: 'x' } }));
});

describe('staff transition allow-list', () => {
  it.each(['REFUND_PENDING', 'REFUNDED', 'REFUND_INITIATED', 'CANCELLED', 'CANCELLED_BY_ADMIN', 'RIDER_ASSIGNED', 'PAYMENT_FAILED'])(
    'refuses %s without touching the order', async (target) => {
      h.order = { status: 'CANCELLED_BY_RESTAURANT', fulfillmentType: 'DELIVERY' };
      const res = await call(target);
      expect(res.status).toBe(400);
      expect(h.transitionOrder).not.toHaveBeenCalled();
    });

  it('refuses PAYMENT_PENDING → RECEIVED by staff', async () => {
    h.order = { status: 'PAYMENT_PENDING', fulfillmentType: 'DELIVERY' };
    expect((await call('RECEIVED')).status).toBe(400);
    expect(h.transitionOrder).not.toHaveBeenCalled();
  });

  it('DELIVERED only for pickup / dine-in', async () => {
    h.order = { status: 'READY', fulfillmentType: 'DELIVERY' };
    expect((await call('DELIVERED')).status).toBe(400);
    h.order = { status: 'READY', fulfillmentType: 'PICKUP' };
    expect((await call('DELIVERED')).status).toBe(200);
  });

  it('kitchen can run the board but not cancel', async () => {
    h.role = 'KITCHEN';
    expect((await call('ACCEPTED')).status).toBe(200);
    expect((await call('CANCELLED_BY_RESTAURANT')).status).toBe(403);
  });

  it('returns a DTO, never the raw row', async () => {
    const body = await (await call('ACCEPTED')).json();
    expect(body).toEqual({ id: 'o1', code: 'C1', status: 'ACCEPTED', refundQueued: false });
  });
});

describe('restaurant cancellation', () => {
  it('queues REFUND_PENDING when a payment was captured', async () => {
    h.captured = { id: 'p1' };
    const res = await call('CANCELLED_BY_RESTAURANT', 'Rejected by admin');
    expect(res.status).toBe(200);
    expect(h.transitionOrder.mock.calls.map((c) => c[1])).toEqual(['CANCELLED_BY_RESTAURANT', 'REFUND_PENDING']);
    expect(h.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cancelReason: 'Rejected by admin', cancelledBy: 'u1' }) }));
    expect(await res.json()).toMatchObject({ status: 'REFUND_PENDING', refundQueued: true });
  });

  it('does not queue a refund for COD / uncaptured orders', async () => {
    const res = await call('CANCELLED_BY_RESTAURANT');
    expect(h.transitionOrder).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ status: 'CANCELLED_BY_RESTAURANT', refundQueued: false });
  });
});
