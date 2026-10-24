/**
 * H14 — "Pay now" must refuse an order that is no longer payable (CANCELLED,
 * REFUNDED, DELIVERED, …). Only PAYMENT_PENDING / PAYMENT_FAILED may open a
 * checkout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let order: any;
const startOnlinePayment = vi.fn();

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: { order: { findUnique: async () => order } } }));
let staffRestaurant: any = null;
vi.mock('@/server/tenancy', () => ({ currentRestaurant: async () => staffRestaurant }));
vi.mock('@/server/payments/online', () => ({
  startOnlinePayment: (...a: any[]) => startOnlinePayment(...a),
  isOnlineMethod: () => true,
  OnlinePaymentError: class extends Error {}
}));

import { POST } from '@/app/api/orders/[id]/pay/route';

const post = () =>
  POST(new Request('http://x', { method: 'POST' }) as any, { params: Promise.resolve({ id: 'o1' }) });

beforeEach(() => {
  session = { user: { id: 'c1', role: 'CUSTOMER' } };
  order = { id: 'o1', customerId: 'c1', status: 'PAYMENT_PENDING', paymentMethod: 'PHONEPE', branch: { restaurantId: 'r1' } };
  staffRestaurant = null;
  startOnlinePayment.mockReset().mockResolvedValue({ paymentId: 'p1' });
});

describe('H14: pay-now status guard', () => {
  it('409 for a cancelled order; never starts a payment', async () => {
    order.status = 'CANCELLED_BY_ADMIN';
    const res = await post();
    expect(res.status).toBe(409);
    expect(startOnlinePayment).not.toHaveBeenCalled();
  });

  it('proceeds for a PAYMENT_FAILED order', async () => {
    order.status = 'PAYMENT_FAILED';
    const res = await post();
    expect(res.status).toBe(200);
    expect(startOnlinePayment).toHaveBeenCalled();
  });
});

describe('pay-now caller scope', () => {
  it('403 for another customer', async () => {
    session = { user: { id: 'c2', role: 'CUSTOMER' } };
    expect((await post()).status).toBe(403);
  });
  it('403 for staff of a different restaurant', async () => {
    session = { user: { id: 'a1', role: 'ADMIN' } };
    staffRestaurant = { id: 'r2' };
    expect((await post()).status).toBe(403);
    expect(startOnlinePayment).not.toHaveBeenCalled();
  });
  it('403 for unrelated roles (rider, QA)', async () => {
    for (const role of ['RIDER', 'QA', 'GUEST']) {
      session = { user: { id: 'x', role } };
      expect((await post()).status).toBe(403);
    }
  });
  it('allows own-restaurant staff and super-admin', async () => {
    session = { user: { id: 'a1', role: 'ADMIN' } };
    staffRestaurant = { id: 'r1' };
    expect((await post()).status).toBe(200);
    session = { user: { id: 's1', role: 'SUPER_ADMIN' } };
    expect((await post()).status).toBe(200);
  });
});
