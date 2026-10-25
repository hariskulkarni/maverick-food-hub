import { describe, it, expect, vi, beforeEach } from 'vitest';

// Customer audit P1-11: a PhonePe reservation deposit is confirmed by the Order Status API
// (no browser signature), never treated as a mock, and only for the exact deposit amount.
const h = vi.hoisted(() => ({
  provider: { name: 'phonepe', verifyPayment: vi.fn() } as { name: string; verifyPayment: ReturnType<typeof vi.fn> },
  confirm: vi.fn(),
  reservation: null as any,
}));
vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'c1', role: 'CUSTOMER' } }) }));
vi.mock('@/server/payments', () => ({ paymentProvider: async () => h.provider }));
vi.mock('@/server/reservations', () => ({ confirmReservation: (...a: unknown[]) => h.confirm(...a) }));
vi.mock('@/app/api/r/[slug]/reservations/_helpers', () => ({ serializeReservation: (r: unknown) => r }));
vi.mock('@/server/db', () => ({
  prisma: { reservation: { findUnique: async () => h.reservation, findUniqueOrThrow: async () => h.reservation } },
}));

import { POST } from '@/app/api/r/[slug]/reservations/[id]/confirm-deposit/route';

const post = (body: unknown = {}) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ slug: 's', id: 'res1' }) });

beforeEach(() => {
  h.confirm.mockReset();
  h.provider.name = 'phonepe';
  h.provider.verifyPayment.mockReset();
  h.reservation = { id: 'res1', customerId: 'c1', status: 'PENDING', depositPaid: false, depositProviderOrderId: 'RES-ABC', depositAmount: 200, branch: { restaurantId: 'r1' } };
});

describe('confirm-deposit with PhonePe', () => {
  it('captured for the deposit amount -> confirmed via status API by merchantOrderId', async () => {
    h.provider.verifyPayment.mockResolvedValue({ ok: true, status: 'CAPTURED', amount: 200, providerPaymentId: 'T1' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.provider.verifyPayment).toHaveBeenCalledWith({ merchantOrderId: 'RES-ABC' });
    expect(h.confirm).toHaveBeenCalledWith('res1', 'T1', { paid: true });
  });
  it('still pending -> 202, not confirmed', async () => {
    h.provider.verifyPayment.mockResolvedValue({ ok: false, status: 'PENDING' });
    const res = await post();
    expect(res.status).toBe(202);
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it('amount mismatch -> 409, not confirmed', async () => {
    h.provider.verifyPayment.mockResolvedValue({ ok: true, status: 'CAPTURED', amount: 1 });
    expect((await post()).status).toBe(409);
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it('failed -> 400', async () => {
    h.provider.verifyPayment.mockResolvedValue({ ok: false, status: 'FAILED', error: 'declined' });
    expect((await post()).status).toBe(400);
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
