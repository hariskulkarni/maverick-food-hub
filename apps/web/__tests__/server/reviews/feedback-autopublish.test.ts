import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  orderFind: vi.fn(),
  findFeedback: vi.fn()
}));
vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'c1' } }) }));
vi.mock('@/server/db', () => ({
  prisma: { order: { findUnique: h.orderFind }, orderFeedback: { create: h.create } }
}));
vi.mock('@/server/audit', () => ({ audit: () => Promise.resolve() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/reviews/rider-rating', () => ({ recomputeRiderRatingForOrder: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/feedback', async () => {
  const actual = await vi.importActual<any>('@/server/feedback');
  return { ...actual, findFeedbackByOrder: h.findFeedback };
});

import { POST } from '@/app/api/customer/orders/[id]/feedback/route';

function call() {
  return POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify({ overallRating: 5 }) }) as any,
    { params: Promise.resolve({ id: 'o1' }) }
  );
}
function order(autoPublishReviews: boolean) {
  return {
    id: 'o1', code: 'FL-1', customerId: 'c1', status: 'DELIVERED',
    deliveredAt: new Date(Date.now() - 3600_000), updatedAt: new Date(), assignment: null,
    branch: { restaurant: { autoPublishReviews } }
  };
}

beforeEach(() => {
  h.create.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'f1', issueTags: [], ...data }));
  h.findFeedback.mockReset().mockResolvedValue(null);
});

describe('feedback create autoPublishReviews gate', () => {
  it('false => HIDDEN (pending admin publish)', async () => {
    h.orderFind.mockResolvedValue(order(false));
    const res = await call();
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0].data.moderationStatus).toBe('HIDDEN');
  });
  it('true => PUBLISHED', async () => {
    h.orderFind.mockResolvedValue(order(true));
    await call();
    expect(h.create.mock.calls[0][0].data.moderationStatus).toBe('PUBLISHED');
  });
});
