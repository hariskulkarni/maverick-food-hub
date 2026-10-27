import { describe, it, expect, vi } from 'vitest';

// UAT O-1: a refused direct-UPI order is a client error (409), not a 500.
const h = vi.hoisted(() => ({ placeOrder: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', role: 'CUSTOMER', phoneVerified: true } })) }));
vi.mock('@/server/orders', async () => {
  class PgUnavailableError extends Error {}
  class CheckoutRejectedError extends Error {}
  return { placeOrder: h.placeOrder, PgUnavailableError, CheckoutRejectedError };
});

import { POST } from '@/app/api/orders/route';
import { PgUnavailableError, CheckoutRejectedError } from '@/server/orders';
import { BenefitUnavailableError } from '@/server/order-benefits';

const req = () => ({ json: async () => ({ branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 1 }], paymentMethod: 'PHONEPE', paymentRail: 'youpi' }) }) as any;

describe('POST /api/orders PG refusal', () => {
  it('maps PgUnavailableError to 409 with the reason', async () => {
    h.placeOrder.mockRejectedValueOnce(new PgUnavailableError('Flavrly PG is not available for this restaurant.'));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not available/);
  });
  it('maps a customer-fixable checkout refusal (wallet/method/closed) to 400', async () => {
    h.placeOrder.mockRejectedValueOnce(new CheckoutRejectedError('Your wallet does not cover this order.'));
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/wallet/);
    h.placeOrder.mockRejectedValueOnce(new BenefitUnavailableError('Wallet balance is lower'));
    expect((await POST(req())).status).toBe(400);
  });
  it('P2-16: rejects absurd quantities / notes with 400 before placing', async () => {
    h.placeOrder.mockClear();
    const big = { json: async () => ({ branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 1e12 }], paymentMethod: 'COD' }) } as any;
    expect((await POST(big)).status).toBe(400);
    const longNote = { json: async () => ({ branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 1, notes: 'x'.repeat(5000) }], paymentMethod: 'COD' }) } as any;
    expect((await POST(longNote)).status).toBe(400);
    expect(h.placeOrder).not.toHaveBeenCalled();
  });
  it('keeps other failures at 500', async () => {
    h.placeOrder.mockRejectedValueOnce(new Error('boom'));
    expect((await POST(req())).status).toBe(500);
  });
});
