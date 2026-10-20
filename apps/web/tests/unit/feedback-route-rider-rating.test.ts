import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  orderFind: vi.fn(),
  findByOrder: vi.fn(),
  recompute: vi.fn()
}));

vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }));
vi.mock('@/server/db', () => ({
  prisma: { order: { findUnique: m.orderFind }, orderFeedback: { create: m.create, update: m.update } }
}));
vi.mock('@/server/audit', () => ({ audit: () => Promise.resolve() }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/feedback', async (orig) => ({
  ...(await orig<any>()),
  findFeedbackByOrder: m.findByOrder
}));
vi.mock('@/server/reviews/rider-rating', () => ({ recomputeRiderRatingForOrder: m.recompute }));

import { POST, PATCH } from '@/app/api/customer/orders/[id]/feedback/route';

const req = (body: unknown) => ({ json: async () => body }) as any;
const ctx = { params: Promise.resolve({ id: 'o1' }) };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.recompute.mockResolvedValue(undefined);
  m.orderFind.mockResolvedValue({
    id: 'o1', code: 'C1', customerId: 'u1', status: 'DELIVERED',
    deliveredAt: new Date(), updatedAt: new Date(), assignment: null
  });
});

describe('feedback route rider rating wiring', () => {
  it('POST with deliveryRating recomputes the rider rating', async () => {
    m.findByOrder.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'f1', deliveryRating: 4, issueTags: [] });
    const res = await POST(req({ deliveryRating: 4 }), ctx);
    expect(res.status).toBe(201);
    expect(m.recompute).toHaveBeenCalledWith('o1');
  });

  it('POST without deliveryRating does not recompute', async () => {
    m.findByOrder.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'f1', deliveryRating: null, issueTags: [] });
    await POST(req({ foodRating: 4 }), ctx);
    expect(m.recompute).not.toHaveBeenCalled();
  });

  it('POST still succeeds when recompute rejects', async () => {
    m.findByOrder.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: 'f1', deliveryRating: 4, issueTags: [] });
    m.recompute.mockRejectedValue(new Error('boom'));
    const res = await POST(req({ deliveryRating: 4 }), ctx);
    expect(res.status).toBe(201);
  });

  it('PATCH recomputes when the delivery rating changes', async () => {
    m.findByOrder.mockResolvedValue({
      id: 'f1', orderId: 'o1', customerId: 'u1', deliveryRating: 5, issueTags: [],
      windowEndsAt: new Date(Date.now() + 1e6)
    });
    m.update.mockResolvedValue({ id: 'f1', deliveryRating: 2, issueTags: [] });
    const res = await PATCH(req({ deliveryRating: 2 }), ctx);
    expect(res.status).toBe(200);
    expect(m.recompute).toHaveBeenCalledWith('o1');
  });
});
