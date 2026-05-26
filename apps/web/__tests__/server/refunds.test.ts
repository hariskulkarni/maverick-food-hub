import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * refundOrder enforces the wallet-default policy, caps cumulative refunds at the
 * order total, and records the chosen destination. We mock prisma + the order
 * state machine so the money logic can be tested in isolation.
 */
const db: any = vi.hoisted(() => ({
  order: { findUnique: vi.fn() },
  wallet: { upsert: vi.fn() },
  walletTransaction: { create: vi.fn() },
  payment: { update: vi.fn() },
  refund: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), info: vi.fn() } }));
const transitionOrder = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/server/orders', () => ({ transitionOrder }));

import { refundOrder, RefundError } from '@/server/refunds';

function order(over: any = {}) {
  return {
    id: 'o1',
    code: 'FL-001',
    customerId: 'cust1',
    status: 'DELIVERED',
    total: 500,
    payments: [],
    refunds: [],
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) =>
    fn({
      wallet: { upsert: db.wallet.upsert },
      walletTransaction: { create: db.walletTransaction.create },
      payment: { update: db.payment.update },
      refund: { create: db.refund.create }
    })
  );
  db.wallet.upsert.mockResolvedValue({ id: 'w1' });
  db.walletTransaction.create.mockResolvedValue({});
  db.refund.create.mockResolvedValue({ id: 'rf1' });
  db.payment.update.mockResolvedValue({});
  transitionOrder.mockResolvedValue({});
});

describe('refundOrder — wallet (default)', () => {
  it('credits the wallet and records a WALLET refund', async () => {
    db.order.findUnique.mockResolvedValue(order());
    const res = await refundOrder({ orderId: 'o1', amount: 200, destination: 'WALLET' });
    expect(res.destination).toBe('WALLET');
    expect(res.walletCredited).toBe(200);
    expect(db.wallet.upsert).toHaveBeenCalled();
    expect(db.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'REFUND' }) })
    );
    expect(db.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ destination: 'WALLET', status: 'COMPLETED' }) })
    );
  });

  it('works for COD orders with no captured payment (paymentId null)', async () => {
    db.order.findUnique.mockResolvedValue(order({ payments: [] }));
    await refundOrder({ orderId: 'o1', amount: 100, destination: 'WALLET' });
    expect(db.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: null }) })
    );
  });
});

describe('refundOrder — original payment', () => {
  it('rejects original-payment refund when there is no captured payment', async () => {
    db.order.findUnique.mockResolvedValue(order({ payments: [] }));
    await expect(refundOrder({ orderId: 'o1', amount: 100, destination: 'ORIGINAL_PAYMENT' }))
      .rejects.toThrow(/no captured online payment/i);
  });

  it('refunds to the captured payment and marks it REFUNDED on a full refund', async () => {
    db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'pay1', status: 'CAPTURED', providerName: 'razorpay' }] }));
    const res = await refundOrder({ orderId: 'o1', amount: 500, destination: 'ORIGINAL_PAYMENT' });
    expect(res.destination).toBe('ORIGINAL_PAYMENT');
    expect(res.walletCredited).toBe(0);
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay1' }, data: { status: 'REFUNDED' } })
    );
  });
});

describe('refundOrder — guards', () => {
  it('rejects non-positive amounts', async () => {
    db.order.findUnique.mockResolvedValue(order());
    await expect(refundOrder({ orderId: 'o1', amount: 0, destination: 'WALLET' })).rejects.toBeInstanceOf(RefundError);
  });

  it('rejects orders that are not in a refundable status', async () => {
    db.order.findUnique.mockResolvedValue(order({ status: 'PREPARING' }));
    await expect(refundOrder({ orderId: 'o1', amount: 50, destination: 'WALLET' })).rejects.toThrow(/cannot be refunded/i);
  });

  it('caps the refund at the remaining balance', async () => {
    db.order.findUnique.mockResolvedValue(order({ total: 500, refunds: [{ amount: 400 }] }));
    // remaining = 100; asking for 200 must fail
    await expect(refundOrder({ orderId: 'o1', amount: 200, destination: 'WALLET' })).rejects.toThrow(/exceeds/i);
  });

  it('rejects when already fully refunded', async () => {
    db.order.findUnique.mockResolvedValue(order({ total: 500, refunds: [{ amount: 500 }] }));
    await expect(refundOrder({ orderId: 'o1', amount: 10, destination: 'WALLET' })).rejects.toThrow(/already fully refunded/i);
  });

  it('advances a full refund through to REFUNDED', async () => {
    db.order.findUnique.mockResolvedValue(order({ total: 500, refunds: [] }));
    await refundOrder({ orderId: 'o1', amount: 500, destination: 'WALLET' });
    // last transition target should be REFUNDED for a full refund
    const calls = transitionOrder.mock.calls.map((c: any[]) => c[1]);
    expect(calls).toContain('REFUNDED');
  });

  it('parks a partial refund at REFUND_INITIATED', async () => {
    db.order.findUnique.mockResolvedValue(order({ total: 500, refunds: [] }));
    await refundOrder({ orderId: 'o1', amount: 100, destination: 'WALLET' });
    const calls = transitionOrder.mock.calls.map((c: any[]) => c[1]);
    expect(calls).toContain('REFUND_INITIATED');
    expect(calls).not.toContain('REFUNDED');
  });
});
