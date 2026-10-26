/**
 * C3 — /api/payments/verify must be authenticated, owner-scoped, and must never
 * walk a payment backwards or mark an indeterminate result as FAILED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
let order: any = null;
let payment: any = null;
let verifyResult: any = { ok: true, status: 'CAPTURED' };
let providerName = 'razorpay';

vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/payments', () => ({
  paymentProvider: async () => ({ verifyPayment: async () => verifyResult }),
  isPhonePePayment: (n?: string | null) => n === 'phonepe'
}));
vi.mock('@/server/db', () => ({
  prisma: {
    order: { findUnique: async () => order },
    payment: {
      findFirst: async () => payment,
      updateMany: async ({ where, data }: any) => {
        const want = where.status;
        let match = false;
        if (want && typeof want === 'object' && Array.isArray(want.in)) match = want.in.includes(payment.status);
        else match = payment.status === want;
        if (match) {
          Object.assign(payment, data);
          return { count: 1 };
        }
        return { count: 0 };
      }
    }
  }
}));

const rec = vi.hoisted(() => ({ capture: vi.fn(), release: vi.fn() }));
vi.mock('@/server/payments/reconcile', () => ({ captureRazorpayPayment: rec.capture, releaseOrderAfterCapture: rec.release }));

import { POST } from '@/app/api/payments/verify/route';

const post = () =>
  POST(
    new Request('http://x/api/payments/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'o1', providerOrderId: 'po1', providerPaymentId: 'pp1', signature: 'sig' })
    }) as any
  );

beforeEach(() => {
  session = { user: { id: 'cust1' } };
  order = { customerId: 'cust1', branch: { restaurantId: 'r1' } };
  payment = { id: 'pay1', status: 'PENDING', providerName, providerData: {} };
  verifyResult = { ok: true, status: 'CAPTURED' };
  providerName = 'razorpay';
});

describe('C3: payment verify route', () => {
  it('rejects an unauthenticated request (401)', async () => {
    session = null;
    const res = await post();
    expect(res.status).toBe(401);
  });

  it('rejects a non-owner (404)', async () => {
    order = { customerId: 'someone-else', branch: { restaurantId: 'r1' } };
    const res = await post();
    expect(res.status).toBe(404);
  });

  it('leaves the payment PENDING on an UNKNOWN (indeterminate) result', async () => {
    verifyResult = { ok: false, status: 'UNKNOWN', error: 'gateway unreachable' };
    const res = await post();
    expect(res.status).toBe(202);
    expect(payment.status).toBe('PENDING'); // never FAILED
  });

  it('cannot move an already-CAPTURED payment to FAILED', async () => {
    payment = { id: 'pay1', status: 'CAPTURED', providerName: 'razorpay', providerData: {} };
    verifyResult = { ok: false, status: 'FAILED', error: 'declined' };
    const res = await post();
    expect(res.status).toBe(400);
    expect(payment.status).toBe('CAPTURED'); // precondition kept it
  });

  it('captures a PENDING payment and preserves providerRef for PhonePe', async () => {
    payment = { id: 'pay1', status: 'PENDING', providerName: 'phonepe', providerData: {}, providerRef: 'merchant-order-1' };
    verifyResult = { ok: true, status: 'CAPTURED' };
    const res = await post();
    expect(res.status).toBe(200);
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerRef).toBe('merchant-order-1'); // not overwritten with pp1
  });
});

describe('Flavrly PG payments are never captured by browser verify', () => {
  it('409 and payment untouched for providerName youpi', async () => {
    payment = { id: 'pay1', status: 'PENDING', providerName: 'youpi', providerData: {} };
    const res = await post();
    expect(res.status).toBe(409);
    expect(payment.status).toBe('PENDING');
  });

  it('P0-4: a verified Razorpay handler capture goes through the guarded capture helper (releases the order)', async () => {
    rec.capture.mockImplementationOnce(async () => { payment.status = 'CAPTURED'; return true; });
    const res = await post();
    expect(rec.capture).toHaveBeenCalledWith('pay1', { gatewayPaymentId: 'pp1', source: 'checkout' });
    expect((await res.json()).ok).toBe(true);
  });

  it('P0-4: a PhonePe verify capture releases the PAYMENT_PENDING order', async () => {
    rec.release.mockClear();
    payment = { id: 'pay1', orderId: 'o1', status: 'PENDING', providerName: 'phonepe', providerData: {}, providerRef: 'm-1' };
    await post();
    expect(rec.release).toHaveBeenCalledWith('o1', expect.stringContaining('captured'));
  });
});
