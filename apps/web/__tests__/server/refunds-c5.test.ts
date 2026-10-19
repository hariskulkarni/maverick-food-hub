/**
 * C5 — an ORIGINAL_PAYMENT refund must never be recorded COMPLETED without a
 * real gateway confirmation. In production, if no gateway could be reached
 * (unresolvable credentials), refundOrder must throw and write no Refund row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  order: { findUnique: vi.fn() },
  branch: { findUnique: vi.fn() },
  wallet: { upsert: vi.fn() },
  walletTransaction: { create: vi.fn() },
  payment: { update: vi.fn() },
  refund: { create: vi.fn() },
  $transaction: vi.fn()
}));
const getConfigInherited = vi.hoisted(() => vi.fn());
const razorpayRefund = vi.hoisted(() => vi.fn());

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/server/orders', () => ({ transitionOrder: vi.fn().mockResolvedValue({}) }));
vi.mock('@/server/integrations', () => ({ getConfigInherited }));
vi.mock('@/server/payments/razorpay', () => ({ razorpayProvider: () => ({ refund: razorpayRefund }) }));
vi.mock('@/server/payments/phonepe', () => ({ phonepeProvider: () => ({}), resolvePhonePeConfig: async () => null }));
vi.mock('@/server/payments/phonepe-events', () => ({ isWithinRefundWindow: () => true, REFUND_WINDOW_DAYS: 90 }));
vi.mock('@/server/payments/phonepe-api', () => ({ toMerchantId: (s: string) => s }));

import { refundOrder, RefundError } from '@/server/refunds';

const orderWith = (providerName: string) => ({
  id: 'o1',
  code: 'FL-001',
  customerId: 'cust1',
  branchId: 'b1',
  status: 'DELIVERED',
  total: 500,
  payments: [{ id: 'pay1', status: 'CAPTURED', providerName, providerRef: 'ref_123', createdAt: new Date(), updatedAt: new Date() }],
  refunds: []
});

beforeEach(() => {
  vi.clearAllMocks();
  db.branch.findUnique.mockResolvedValue({ restaurantId: 'r1' });
  db.refund.create.mockResolvedValue({ id: 'rf1' });
  db.payment.update.mockResolvedValue({});
  db.$transaction.mockImplementation(async (fn: any) =>
    fn({ refund: { create: db.refund.create }, payment: { update: db.payment.update } })
  );
});
afterEach(() => vi.unstubAllEnvs());

describe('C5: ORIGINAL_PAYMENT refund gateway integrity', () => {
  it('throws in production when no gateway credentials resolve, writing no Refund', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '');
    getConfigInherited.mockResolvedValue(null); // razorpay creds unresolvable
    db.order.findUnique.mockResolvedValue(orderWith('razorpay'));

    await expect(refundOrder({ orderId: 'o1', amount: 100, destination: 'ORIGINAL_PAYMENT' })).rejects.toBeInstanceOf(RefundError);
    expect(db.refund.create).not.toHaveBeenCalled();
  });

  it('settles a mock payment immediately in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    getConfigInherited.mockResolvedValue(null);
    db.order.findUnique.mockResolvedValue(orderWith('mock'));

    const res = await refundOrder({ orderId: 'o1', amount: 100, destination: 'ORIGINAL_PAYMENT' });
    expect(res.status).toBe('COMPLETED');
    expect(db.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('leaves a real Razorpay refund PENDING for the webhook', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    getConfigInherited.mockResolvedValue({ config: { keyId: 'k', keySecret: 's' } });
    razorpayRefund.mockResolvedValue({ ok: true, providerRefundId: 'rp_1' });
    db.order.findUnique.mockResolvedValue(orderWith('razorpay'));

    const res = await refundOrder({ orderId: 'o1', amount: 100, destination: 'ORIGINAL_PAYMENT' });
    expect(res.status).toBe('PENDING');
    expect(db.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) })
    );
  });
});
