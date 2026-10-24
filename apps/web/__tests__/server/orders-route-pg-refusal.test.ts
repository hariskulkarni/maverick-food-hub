import { describe, it, expect, vi } from 'vitest';

// UAT O-1: a refused direct-UPI order is a client error (409), not a 500.
const h = vi.hoisted(() => ({ placeOrder: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', role: 'CUSTOMER' } })) }));
vi.mock('@/server/orders', async () => {
  class PgUnavailableError extends Error {}
  return { placeOrder: h.placeOrder, PgUnavailableError };
});

import { POST } from '@/app/api/orders/route';
import { PgUnavailableError } from '@/server/orders';

const req = () => ({ json: async () => ({ branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 1 }], paymentMethod: 'PHONEPE', paymentRail: 'youpi' }) }) as any;

describe('POST /api/orders PG refusal', () => {
  it('maps PgUnavailableError to 409 with the reason', async () => {
    h.placeOrder.mockRejectedValueOnce(new PgUnavailableError('Flavrly PG is not available for this restaurant.'));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not available/);
  });
  it('keeps other failures at 500', async () => {
    h.placeOrder.mockRejectedValueOnce(new Error('boom'));
    expect((await POST(req())).status).toBe(500);
  });
});
