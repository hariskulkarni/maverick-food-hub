/**
 * H13 — startOnlinePayment must create the local Payment row BEFORE calling the
 * gateway, and mark it FAILED if the gateway call throws (never leave a payable
 * gateway order with no local record).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createOrder = vi.fn();
let created: any[] = [];
let updated: any[] = [];

vi.mock('@/server/payments', () => ({
  paymentProvider: async () => ({ name: 'phonepe', createOrder }),
  type: {}
}));
vi.mock('@/server/payments/index', () => ({ paymentProvider: async () => ({ name: 'phonepe', createOrder }) }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/db', () => ({
  prisma: {
    order: {
      findUnique: async () => ({
        id: 'o1', code: 'FL-1', total: 200, currency: 'INR', paymentMethod: 'PHONEPE',
        customer: {}, branch: { id: 'b1', restaurantId: 'r1' }, payments: []
      })
    },
    payment: {
      create: async ({ data }: any) => { const row = { id: 'pay1', ...data }; created.push(row); return row; },
      update: async ({ data }: any) => { updated.push(data); return {}; },
      updateMany: async () => ({ count: 0 })
    }
  }
}));

import { startOnlinePayment, OnlinePaymentError } from '@/server/payments/online';

beforeEach(() => { created = []; updated = []; createOrder.mockReset(); });

describe('H13: Payment row precedes the gateway call', () => {
  it('marks the pre-created row FAILED when the gateway throws', async () => {
    createOrder.mockRejectedValue(new Error('gateway down'));
    await expect(startOnlinePayment('o1')).rejects.toBeInstanceOf(OnlinePaymentError);
    // a PENDING row was created BEFORE the gateway call
    expect(created.some((r) => r.status === 'PENDING')).toBe(true);
    // and then marked FAILED
    expect(updated.some((d) => d.status === 'FAILED')).toBe(true);
  });

  it('fills the provider ref after a successful gateway call', async () => {
    createOrder.mockResolvedValue({ providerName: 'phonepe', providerOrderId: 'o1-1', amount: 200, currency: 'INR', raw: {} });
    await startOnlinePayment('o1');
    expect(created.some((r) => r.status === 'PENDING')).toBe(true);
    expect(updated.some((d) => d.providerRef === 'o1-1')).toBe(true);
  });
});
