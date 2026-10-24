import { describe, it, expect, vi } from 'vitest';

let order: any;
vi.mock('@/app/api/admin/orders/_helpers', () => ({
  requireOrderAdminScope: async () => ({ session: {}, scopeRestaurantId: 'r1' }),
  orderScopeWhere: (id: string) => ({ id }),
}));
vi.mock('@/server/db', () => ({ prisma: { order: { findFirst: async () => order } } }));
const handleOrderRelease = vi.fn();
vi.mock('@/server/pg/fulfillment', () => ({ handleOrderRelease: (p: unknown) => handleOrderRelease(p) }));

import { GET as kot } from '@/app/api/admin/orders/[id]/kot/route';
import { outboxHandlers } from '@/server/pg/outbox-handlers';

const base = { id: 'o1', code: 'ORD-1', items: [], branch: { name: 'B' }, placedAt: new Date(), customerNotes: null };

describe('KOT never prints an unpaid prepaid order', () => {
  it.each(['PAYMENT_PENDING', 'PAYMENT_FAILED'])('409 for %s', async (status) => {
    order = { ...base, status };
    const res = await kot(new Request('http://x') as any, { params: Promise.resolve({ id: 'o1' }) });
    expect(res.status).toBe(409);
  });
  it('prints a received order', async () => {
    order = { ...base, status: 'RECEIVED' };
    const res = await kot(new Request('http://x') as any, { params: Promise.resolve({ id: 'o1' }) });
    expect(res.status).toBe(200);
  });
});

describe('outbox registry', () => {
  it('routes ORDER_RELEASE to fulfillment', async () => {
    const p = { orderId: 'o1', attemptId: 'a1', paymentId: 'p1' };
    await outboxHandlers.ORDER_RELEASE(p, { id: 'x', topic: 'ORDER_RELEASE', aggregateId: 'o1', attempts: 1 });
    expect(handleOrderRelease).toHaveBeenCalledWith(p);
  });
});
