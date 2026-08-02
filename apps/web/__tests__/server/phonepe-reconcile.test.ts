/**
 * Payment reconciliation — the single writer for online payment outcomes.
 *
 * These tests exist to pin down the safety properties, not just the happy path:
 *   • a captured payment is never rewritten by a late event
 *   • an unreachable gateway never marks a payment FAILED
 *   • capture is idempotent, so webhook + return + poll + sweep can all race
 *   • PAYMENT_FAILED (which releases bonus holds) is gated behind a dead checkout
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db: any = vi.hoisted(() => ({
  payment: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  refund: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  order: { findUnique: vi.fn() },
  codCollection: { findUnique: vi.fn(), update: vi.fn() },
}));
const orders = vi.hoisted(() => ({
  maybeAutoAccept: vi.fn().mockResolvedValue(undefined),
  transitionOrder: vi.fn().mockResolvedValue({}),
}));
const api = vi.hoisted(() => ({ getOrderStatus: vi.fn(), getRefundStatus: vi.fn() }));
const phonepe = vi.hoisted(() => ({ resolvePhonePeConfig: vi.fn() }));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/orders', () => orders);
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/payments/phonepe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/payments/phonepe-api')>();
  return { ...actual, ...api };
});
vi.mock('@/server/payments/phonepe', () => phonepe);

import {
  markOrderPaymentFailed,
  reconcilePhonePePayment,
  reconcilePhonePeRefund,
} from '@/server/payments/reconcile';

const CFG = { clientId: 'A', clientSecret: 'B', clientVersion: '1', env: 'SANDBOX' as const };

function payment(over: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    orderId: 'ord_1',
    status: 'PENDING',
    providerRef: 'ord_1-1',
    providerName: 'phonepe',
    providerData: { _expireAt: Date.now() + 600_000 },
    order: { id: 'ord_1', status: 'RECEIVED', branch: { restaurantId: 'rest_1' } },
    ...over,
  };
}

function status(over: Record<string, unknown> = {}) {
  return { orderId: 'OMO1', state: 'COMPLETED', amount: 49950, paymentDetails: [], raw: {}, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  phonepe.resolvePhonePeConfig.mockResolvedValue(CFG);
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.payment.update.mockResolvedValue({});
  db.refund.update.mockResolvedValue({});
  db.refund.findMany.mockResolvedValue([]);
  db.codCollection.findUnique.mockResolvedValue(null);
  db.codCollection.update.mockResolvedValue({});
  orders.maybeAutoAccept.mockResolvedValue(undefined);
  orders.transitionOrder.mockResolvedValue({});
});

describe('reconcilePhonePePayment — capture', () => {
  it('captures a completed payment and triggers auto-accept', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(
      status({ paymentDetails: [{ transactionId: 'OM9', paymentMode: 'UPI_INTENT', state: 'COMPLETED' }], feeAmount: 118 }),
    );

    const res = await reconcilePhonePePayment('pay_1');

    expect(res).toMatchObject({ status: 'CAPTURED', captured: true, orderId: 'ord_1' });
    expect(orders.maybeAutoAccept).toHaveBeenCalledWith('ord_1', 'rest_1');

    const update = db.payment.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe('CAPTURED');
    expect(update.data.errorMessage).toBeNull();
    expect(update.data.providerData._transactionId).toBe('OM9');
    expect(update.data.providerData._paymentMode).toBe('UPI_INTENT');
    expect(update.data.providerData._feeAmount).toBe(118);
  });

  it('keeps providerRef as the merchantOrderId so refunds stay addressable', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status({ paymentDetails: [{ transactionId: 'OM9', state: 'COMPLETED' }] }));
    await reconcilePhonePePayment('pay_1');
    // Unlike the Razorpay path, providerRef must NOT be overwritten with the
    // transaction id — PhonePe refunds key on the original merchantOrderId.
    expect(db.payment.updateMany.mock.calls[0][0].data).not.toHaveProperty('providerRef');
  });

  it('only captures rows still in a non-terminal state (concurrency guard)', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    await reconcilePhonePePayment('pay_1');
    expect(db.payment.updateMany.mock.calls[0][0].where).toEqual({
      id: 'pay_1',
      status: { in: ['PENDING', 'AUTHORIZED', 'FAILED'] },
    });
  });

  it('is idempotent — a second caller that loses the race does not re-auto-accept', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    db.payment.updateMany.mockResolvedValue({ count: 0 }); // someone else got there first
    const res = await reconcilePhonePePayment('pay_1');
    expect(res).toMatchObject({ status: 'CAPTURED', captured: false });
    expect(orders.maybeAutoAccept).not.toHaveBeenCalled();
  });

  it('pulls an order back out of PAYMENT_FAILED when a retry succeeds', async () => {
    db.payment.findUnique.mockResolvedValue(
      payment({ order: { id: 'ord_1', status: 'PAYMENT_FAILED', branch: { restaurantId: 'rest_1' } } }),
    );
    api.getOrderStatus.mockResolvedValue(status());
    await reconcilePhonePePayment('pay_1');
    expect(orders.transitionOrder).toHaveBeenCalledWith('ord_1', 'RECEIVED', expect.anything());
    expect(orders.maybeAutoAccept).toHaveBeenCalled();
  });

  it('does not transition an order that is already RECEIVED', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    await reconcilePhonePePayment('pay_1');
    expect(orders.transitionOrder).not.toHaveBeenCalled();
  });

  it('still reports capture when auto-accept throws', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    orders.maybeAutoAccept.mockRejectedValue(new Error('kitchen offline'));
    await expect(reconcilePhonePePayment('pay_1')).resolves.toMatchObject({ captured: true });
  });
});

describe('reconcilePhonePePayment — digital COD collection', () => {
  it('closes out a pending COD record with zero cash when a rider collects by UPI', async () => {
    db.payment.findUnique.mockResolvedValue(payment({ amount: 499.5 }));
    api.getOrderStatus.mockResolvedValue(status({ paymentDetails: [{ state: 'COMPLETED', paymentMode: 'UPI_QR' }] }));
    db.codCollection.findUnique.mockResolvedValue({ id: 'cod_1', status: 'PENDING_COLLECTION', notes: null });

    await reconcilePhonePePayment('pay_1');

    const data = db.codCollection.update.mock.calls[0][0].data;
    expect(data.status).toBe('COLLECTED');
    // Zero cash in hand — the rider is carrying nothing for this order.
    expect(data.amountCollected).toBe(0);
    expect(data.collectedAt).toBeInstanceOf(Date);
    expect(data.notes).toContain('PhonePe');
    expect(data.notes).toContain('UPI_QR');
    // Stops short of RECONCILED — that stays a finance action.
    expect(data.status).not.toBe('RECONCILED');
  });

  it('preserves any existing COD note', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    db.codCollection.findUnique.mockResolvedValue({ id: 'cod_1', status: 'PENDING_COLLECTION', notes: 'Customer asked for change.' });
    await reconcilePhonePePayment('pay_1');
    expect(db.codCollection.update.mock.calls[0][0].data.notes).toContain('Customer asked for change.');
  });

  it('leaves an already-handled COD record alone', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    db.codCollection.findUnique.mockResolvedValue({ id: 'cod_1', status: 'RECONCILED', notes: null });
    await reconcilePhonePePayment('pay_1');
    expect(db.codCollection.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an ordinary online order with no COD record', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    await reconcilePhonePePayment('pay_1');
    expect(db.codCollection.update).not.toHaveBeenCalled();
  });

  it('still reports capture when the COD update throws', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status());
    db.codCollection.findUnique.mockRejectedValue(new Error('db blip'));
    await expect(reconcilePhonePePayment('pay_1')).resolves.toMatchObject({ captured: true });
  });
});

describe('reconcilePhonePePayment — terminal-state protection', () => {
  it('never re-queries or rewrites an already-CAPTURED payment', async () => {
    db.payment.findUnique.mockResolvedValue(payment({ status: 'CAPTURED' }));
    const res = await reconcilePhonePePayment('pay_1');
    expect(res).toMatchObject({ status: 'CAPTURED', captured: false });
    expect(api.getOrderStatus).not.toHaveBeenCalled();
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('never rewrites a REFUNDED payment', async () => {
    db.payment.findUnique.mockResolvedValue(payment({ status: 'REFUNDED' }));
    const res = await reconcilePhonePePayment('pay_1');
    expect(res.status).toBe('REFUNDED');
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('reconcilePhonePePayment — failure', () => {
  it('marks the payment FAILED with customer-safe copy but leaves the order alone', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(
      status({ state: 'FAILED', errorCode: 'AUTHORIZATION_ERROR', detailedErrorCode: 'Z9' }),
    );

    const res = await reconcilePhonePePayment('pay_1');
    expect(res.status).toBe('FAILED');
    expect(res.error).toMatch(/insufficient balance/i);
    // Order status is NOT advanced here — that would release the signup-bonus
    // hold on a failure the customer may still retry past.
    expect(orders.transitionOrder).not.toHaveBeenCalled();
    expect(db.payment.updateMany.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('reads error codes off the attempt when the root has none', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(
      status({ state: 'FAILED', paymentDetails: [{ state: 'FAILED', errorCode: 'X', detailedErrorCode: 'ZM' }] }),
    );
    const res = await reconcilePhonePePayment('pay_1');
    expect(res.error).toBe('Incorrect UPI PIN. Please try again.');
  });
});

describe('reconcilePhonePePayment — indeterminate', () => {
  it('leaves the payment PENDING when the gateway is unreachable', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockRejectedValue(new Error('ECONNRESET'));
    const res = await reconcilePhonePePayment('pay_1');
    expect(res).toMatchObject({ status: 'PENDING', captured: false, indeterminate: true });
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('is indeterminate — not failed — when no credentials resolve', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    phonepe.resolvePhonePeConfig.mockResolvedValue(null);
    const res = await reconcilePhonePePayment('pay_1');
    expect(res.indeterminate).toBe(true);
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('is indeterminate when the payment has no merchant reference', async () => {
    db.payment.findUnique.mockResolvedValue(payment({ providerRef: null }));
    const res = await reconcilePhonePePayment('pay_1');
    expect(res.indeterminate).toBe(true);
    expect(api.getOrderStatus).not.toHaveBeenCalled();
  });

  it('reports PENDING plainly while the customer is still paying', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    api.getOrderStatus.mockResolvedValue(status({ state: 'PENDING' }));
    const res = await reconcilePhonePePayment('pay_1');
    expect(res).toMatchObject({ status: 'PENDING', captured: false });
    expect(res.indeterminate).toBeUndefined();
  });

  it('reuses a status response supplied by the sweeper instead of re-querying', async () => {
    db.payment.findUnique.mockResolvedValue(payment());
    await reconcilePhonePePayment('pay_1', { statusOverride: status() as any });
    expect(api.getOrderStatus).not.toHaveBeenCalled();
  });
});

describe('markOrderPaymentFailed', () => {
  it('advances a RECEIVED unpaid order', async () => {
    db.order.findUnique.mockResolvedValue({ status: 'RECEIVED', payments: [{ status: 'PENDING' }] });
    expect(await markOrderPaymentFailed('ord_1', 'expired')).toBe(true);
    expect(orders.transitionOrder).toHaveBeenCalledWith('ord_1', 'PAYMENT_FAILED', { note: 'expired' });
  });

  it('refuses to fail an order that has a captured payment', async () => {
    db.order.findUnique.mockResolvedValue({ status: 'RECEIVED', payments: [{ status: 'CAPTURED' }] });
    expect(await markOrderPaymentFailed('ord_1', 'expired')).toBe(false);
    expect(orders.transitionOrder).not.toHaveBeenCalled();
  });

  it('refuses to touch an order that has moved on', async () => {
    db.order.findUnique.mockResolvedValue({ status: 'DELIVERED', payments: [] });
    expect(await markOrderPaymentFailed('ord_1', 'expired')).toBe(false);
    expect(orders.transitionOrder).not.toHaveBeenCalled();
  });

  it('swallows an illegal transition rather than throwing at the sweeper', async () => {
    db.order.findUnique.mockResolvedValue({ status: 'RECEIVED', payments: [] });
    orders.transitionOrder.mockRejectedValue(new Error('Cannot transition'));
    expect(await markOrderPaymentFailed('ord_1', 'expired')).toBe(false);
  });
});

describe('reconcilePhonePeRefund', () => {
  function refund(over: Record<string, unknown> = {}) {
    return {
      id: 'rf_1',
      orderId: 'ord_1',
      paymentId: 'pay_1',
      status: 'PENDING',
      providerRef: 'rfnd-abc',
      providerData: {},
      payment: { id: 'pay_1', status: 'CAPTURED', amount: 500 },
      order: { id: 'ord_1', status: 'REFUND_INITIATED', total: 500, branch: { restaurantId: 'rest_1' } },
      ...over,
    };
  }

  it('settles a completed refund, marks the payment REFUNDED and the order REFUNDED', async () => {
    db.refund.findUnique.mockResolvedValue(refund());
    api.getRefundStatus.mockResolvedValue({ state: 'COMPLETED', raw: {} });
    db.refund.findMany.mockResolvedValue([{ amount: 500 }]);

    const res = await reconcilePhonePeRefund('rf_1');
    expect(res).toEqual({ status: 'COMPLETED', settled: true });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: 'pay_1' }, data: { status: 'REFUNDED' } });
    expect(orders.transitionOrder).toHaveBeenCalledWith('ord_1', 'REFUNDED', expect.anything());
  });

  it('parks a partial refund at REFUND_INITIATED and leaves the payment captured', async () => {
    db.refund.findUnique.mockResolvedValue(refund());
    api.getRefundStatus.mockResolvedValue({ state: 'COMPLETED', raw: {} });
    db.refund.findMany.mockResolvedValue([{ amount: 200 }]);

    await reconcilePhonePeRefund('rf_1');
    expect(db.payment.update).not.toHaveBeenCalled();
    expect(orders.transitionOrder).toHaveBeenCalledWith('ord_1', 'REFUND_INITIATED', expect.anything());
  });

  it('records a failed refund without touching the order', async () => {
    db.refund.findUnique.mockResolvedValue(refund());
    api.getRefundStatus.mockResolvedValue({ state: 'FAILED', detailedErrorCode: 'BF_034', raw: {} });
    const res = await reconcilePhonePeRefund('rf_1');
    expect(res).toEqual({ status: 'FAILED', settled: false });
    expect(orders.transitionOrder).not.toHaveBeenCalled();
  });

  it('leaves a still-pending refund alone', async () => {
    db.refund.findUnique.mockResolvedValue(refund());
    api.getRefundStatus.mockResolvedValue({ state: 'PENDING', raw: {} });
    const res = await reconcilePhonePeRefund('rf_1');
    expect(res.settled).toBe(false);
    expect(db.refund.update).not.toHaveBeenCalled();
  });

  it('never re-settles an already COMPLETED refund', async () => {
    db.refund.findUnique.mockResolvedValue(refund({ status: 'COMPLETED' }));
    const res = await reconcilePhonePeRefund('rf_1');
    expect(res).toEqual({ status: 'COMPLETED', settled: true });
    expect(api.getRefundStatus).not.toHaveBeenCalled();
    expect(db.payment.update).not.toHaveBeenCalled();
  });

  it('does nothing when the gateway is unreachable', async () => {
    db.refund.findUnique.mockResolvedValue(refund());
    api.getRefundStatus.mockRejectedValue(new Error('timeout'));
    const res = await reconcilePhonePeRefund('rf_1');
    expect(res.settled).toBe(false);
    expect(db.refund.update).not.toHaveBeenCalled();
  });

  it('tolerates float drift when deciding a refund is full', async () => {
    db.refund.findUnique.mockResolvedValue(refund({ order: { ...refund().order, total: 500.0 } }));
    api.getRefundStatus.mockResolvedValue({ state: 'COMPLETED', raw: {} });
    db.refund.findMany.mockResolvedValue([{ amount: 199.99 }, { amount: 300.01 }]);
    await reconcilePhonePeRefund('rf_1');
    expect(orders.transitionOrder).toHaveBeenCalledWith('ord_1', 'REFUNDED', expect.anything());
  });
});
