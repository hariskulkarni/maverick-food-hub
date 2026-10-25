/**
 * C2 — the mock-payment confirmation route must be refused in production.
 * Kept for dev/demo (your chosen option b), 404 in production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

let session: any = { user: { id: 'cust1' } };
let order: any = null;

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: { findUnique: async () => order },
    payment: {
      updateMany: async ({ data }: any) => {
        let count = 0;
        if (order) for (const p of order.payments) if (p.status === 'PENDING') { p.status = data.status; count++; }
        return { count };
      }
    }
  }
}));
const release = vi.fn(async (..._a: any[]) => undefined);
vi.mock('@/server/payments/reconcile', () => ({ releaseOrderAfterCapture: (...a: any[]) => release(...a) }));

import { POST } from '@/app/api/orders/[id]/confirm-mock-payment/route';

const post = () => POST({} as any, { params: Promise.resolve({ id: 'o1' }) });

beforeEach(() => {
  session = { user: { id: 'cust1' } };
  order = { id: 'o1', customerId: 'cust1', payments: [{ status: 'PENDING', providerName: 'mock' }] };
});
afterEach(() => vi.unstubAllEnvs());

describe('C2: confirm-mock-payment route', () => {
  it('404s in production without DEMO_MODE, leaving the payment PENDING', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '');
    const res = await post();
    expect(res.status).toBe(404);
    expect(order.payments[0].status).toBe('PENDING');
  });

  it('works in development (captures the mock payment)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = await post();
    expect(res.status).toBe(200);
    expect(order.payments[0].status).toBe('CAPTURED');
    // The PAYMENT_PENDING order is released to the kitchen like a real capture.
    expect(release).toHaveBeenCalled();
  });

  it('works in production when DEMO_MODE=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', 'true');
    const res = await post();
    expect(res.status).toBe(200);
    expect(order.payments[0].status).toBe('CAPTURED');
  });
});
