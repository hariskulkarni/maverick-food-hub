/**
 * Online payment sessions, the reconciliation sweeper, and the integration
 * registry entry that lets a tenant self-serve PhonePe credentials.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db: any = vi.hoisted(() => ({
  order: { findUnique: vi.fn() },
  payment: { create: vi.fn(), findMany: vi.fn() },
  refund: { findMany: vi.fn() },
}));
const payments = vi.hoisted(() => ({ paymentProvider: vi.fn() }));
const reconcile = vi.hoisted(() => ({
  reconcilePhonePePayment: vi.fn(),
  reconcilePhonePeRefund: vi.fn(),
  markOrderPaymentFailed: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/payments/index', () => payments);
vi.mock('@/server/payments/reconcile', () => reconcile);

import { isOnlineMethod, ONLINE_METHODS, OnlinePaymentError, startOnlinePayment } from '@/server/payments/online';
import { runPhonePeReconcileSweep } from '@/server/jobs/phonepe-reconcile-sweep';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

const providerOrder = {
  providerName: 'phonepe',
  providerOrderId: 'ord_1-1',
  amount: 499.5,
  currency: 'INR',
  redirectUrl: 'https://mercury-stg.phonepe.com/transact?token=abc',
  gatewayOrderId: 'OMO1',
  expireAt: 1900000000000,
  checkoutScriptUrl: 'https://mercury-stg.phonepe.com/web/bundle/checkout.js',
  env: 'SANDBOX',
  raw: { orderId: 'OMO1' },
};

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'ord_1',
    code: 'ORD-AB12CD',
    total: 499.5,
    currency: 'INR',
    paymentMethod: 'PHONEPE',
    customer: { name: 'Asha', phone: '+919876543210', email: null },
    branch: { id: 'branch_1', restaurantId: 'rest_1' },
    payments: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.payment.create.mockImplementation(async ({ data }: any) => ({ id: 'pay_new', ...data }));
  payments.paymentProvider.mockResolvedValue({ name: 'phonepe', createOrder: vi.fn().mockResolvedValue(providerOrder) });
});

describe('isOnlineMethod', () => {
  it('covers exactly the gateway methods', () => {
    expect(isOnlineMethod('RAZORPAY')).toBe(true);
    expect(isOnlineMethod('PHONEPE')).toBe(true);
    expect(isOnlineMethod('COD')).toBe(false);
    expect(isOnlineMethod('WALLET')).toBe(false);
    expect(isOnlineMethod(null)).toBe(false);
    expect(isOnlineMethod(undefined)).toBe(false);
    expect(ONLINE_METHODS).toEqual(['RAZORPAY', 'PHONEPE']);
  });
});

describe('startOnlinePayment', () => {
  it('creates a PENDING Payment keyed on the merchant order id', async () => {
    db.order.findUnique.mockResolvedValue(order());
    const session = await startOnlinePayment('ord_1');

    const created = db.payment.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      orderId: 'ord_1',
      method: 'PHONEPE',
      status: 'PENDING',
      providerName: 'phonepe',
      providerRef: 'ord_1-1',
    });
    // The PayPage expiry is stored so the sweeper can tell a dead checkout from
    // a slow one.
    expect(created.providerData._expireAt).toBe(1900000000000);
    expect(created.providerData._attempt).toBe(1);
    expect(created.providerData._gatewayOrderId).toBe('OMO1');

    expect(session).toMatchObject({
      paymentId: 'pay_new',
      providerName: 'phonepe',
      redirectUrl: providerOrder.redirectUrl,
      checkoutScriptUrl: providerOrder.checkoutScriptUrl,
      env: 'SANDBOX',
    });
  });

  it('mints a new merchant order id per attempt — PhonePe rejects a reused one', async () => {
    db.order.findUnique.mockResolvedValue(
      order({ payments: [{ id: 'p1', method: 'PHONEPE', status: 'FAILED' }, { id: 'p2', method: 'PHONEPE', status: 'FAILED' }] }),
    );
    await startOnlinePayment('ord_1');
    const createOrder = (await payments.paymentProvider.mock.results[0].value).createOrder;
    expect(createOrder.mock.calls[0][0].merchantOrderId).toBe('ord_1-3');
  });

  it('does not count COD/wallet rows when numbering attempts', async () => {
    db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'p1', method: 'WALLET', status: 'CAPTURED' }] }));
    // A captured wallet row means the order is paid — that is a separate guard,
    // so use a non-captured one here.
    db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'p1', method: 'COD', status: 'PENDING' }] }));
    await startOnlinePayment('ord_1');
    const createOrder = (await payments.paymentProvider.mock.results[0].value).createOrder;
    expect(createOrder.mock.calls[0][0].merchantOrderId).toBe('ord_1-1');
  });

  it('refuses to open a second checkout on an already-paid order', async () => {
    db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'p1', method: 'PHONEPE', status: 'CAPTURED' }] }));
    await expect(startOnlinePayment('ord_1')).rejects.toBeInstanceOf(OnlinePaymentError);
    await expect(startOnlinePayment('ord_1')).rejects.toMatchObject({ status: 409 });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a missing order and a zero-value order', async () => {
    db.order.findUnique.mockResolvedValue(null);
    await expect(startOnlinePayment('nope')).rejects.toMatchObject({ status: 404 });

    db.order.findUnique.mockResolvedValue(order({ total: 0 }));
    await expect(startOnlinePayment('ord_1')).rejects.toBeInstanceOf(OnlinePaymentError);
  });

  it('prefers a caller-supplied amount over the order total (dine-in deposit credit)', async () => {
    db.order.findUnique.mockResolvedValue(order());
    await startOnlinePayment('ord_1', { amount: 250 });
    const createOrder = (await payments.paymentProvider.mock.results[0].value).createOrder;
    expect(createOrder.mock.calls[0][0].amount).toBe(250);
    expect(db.payment.create.mock.calls[0][0].data.amount).toBe(250);
  });

  it('surfaces a gateway failure as a 502 and writes no Payment row', async () => {
    db.order.findUnique.mockResolvedValue(order());
    payments.paymentProvider.mockResolvedValue({
      name: 'phonepe',
      createOrder: vi.fn().mockRejectedValue(new Error('PhonePe is down')),
    });
    await expect(startOnlinePayment('ord_1')).rejects.toMatchObject({ status: 502 });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it('passes order context through for metaInfo', async () => {
    db.order.findUnique.mockResolvedValue(order());
    await startOnlinePayment('ord_1');
    const args = (await payments.paymentProvider.mock.results[0].value).createOrder.mock.calls[0][0];
    expect(args).toMatchObject({ orderId: 'ord_1', orderCode: 'ORD-AB12CD', restaurantId: 'rest_1', branchId: 'branch_1' });
  });
});

describe('runPhonePeReconcileSweep', () => {
  beforeEach(() => {
    db.payment.findMany.mockResolvedValue([]);
    db.refund.findMany.mockResolvedValue([]);
  });

  it('counts captures and leaves everything else alone', async () => {
    db.payment.findMany.mockResolvedValue([{ id: 'pay_1', orderId: 'ord_1', providerData: {} }]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'CAPTURED', captured: true });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ paymentsScanned: 1, captured: 1, ordersMarkedFailed: 0 });
    expect(reconcile.markOrderPaymentFailed).not.toHaveBeenCalled();
  });

  it('retires an order once PhonePe reports a terminal failure', async () => {
    db.payment.findMany.mockResolvedValue([{ id: 'pay_1', orderId: 'ord_1', providerData: {} }]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'FAILED', captured: false });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ failed: 1, ordersMarkedFailed: 1 });
    expect(reconcile.markOrderPaymentFailed).toHaveBeenCalledWith('ord_1', expect.stringMatching(/failed/i));
  });

  it('retires a still-PENDING order once its PayPage has expired past the grace period', async () => {
    db.payment.findMany.mockResolvedValue([
      { id: 'pay_1', orderId: 'ord_1', providerData: { _expireAt: Date.now() - 10 * 60_000 } },
    ]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'PENDING', captured: false });
    const res = await runPhonePeReconcileSweep();
    expect(res.ordersMarkedFailed).toBe(1);
    expect(reconcile.markOrderPaymentFailed).toHaveBeenCalledWith('ord_1', expect.stringMatching(/expired/i));
  });

  it('leaves a PENDING order alone while its checkout is still open', async () => {
    db.payment.findMany.mockResolvedValue([
      { id: 'pay_1', orderId: 'ord_1', providerData: { _expireAt: Date.now() + 10 * 60_000 } },
    ]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'PENDING', captured: false });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ stillPending: 1, ordersMarkedFailed: 0 });
  });

  it('leaves a PENDING order alone when no expiry was recorded', async () => {
    db.payment.findMany.mockResolvedValue([{ id: 'pay_1', orderId: 'ord_1', providerData: {} }]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'PENDING', captured: false });
    expect((await runPhonePeReconcileSweep()).ordersMarkedFailed).toBe(0);
  });

  it('never retires an order just because the gateway was unreachable', async () => {
    db.payment.findMany.mockResolvedValue([
      { id: 'pay_1', orderId: 'ord_1', providerData: { _expireAt: Date.now() - 10 * 60_000 } },
    ]);
    reconcile.reconcilePhonePePayment.mockResolvedValue({ status: 'PENDING', captured: false, indeterminate: true });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ unreachable: 1, ordersMarkedFailed: 0 });
  });

  it('keeps going when one payment throws', async () => {
    db.payment.findMany.mockResolvedValue([
      { id: 'pay_1', orderId: 'ord_1', providerData: {} },
      { id: 'pay_2', orderId: 'ord_2', providerData: {} },
    ]);
    reconcile.reconcilePhonePePayment
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'CAPTURED', captured: true });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ paymentsScanned: 2, captured: 1 });
  });

  it('settles stranded refunds too', async () => {
    db.refund.findMany.mockResolvedValue([{ id: 'rf_1' }, { id: 'rf_2' }]);
    reconcile.reconcilePhonePeRefund
      .mockResolvedValueOnce({ status: 'COMPLETED', settled: true })
      .mockResolvedValueOnce({ status: 'PENDING', settled: false });
    const res = await runPhonePeReconcileSweep();
    expect(res).toMatchObject({ refundsScanned: 2, refundsSettled: 1 });
  });

  it('only sweeps PhonePe payments that have had time to settle', async () => {
    await runPhonePeReconcileSweep();
    const where = db.payment.findMany.mock.calls[0][0].where;
    expect(where.providerName).toBe('phonepe');
    expect(where.status).toEqual({ in: ['PENDING', 'AUTHORIZED'] });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(where.createdAt.gt).toBeInstanceOf(Date);
  });
});

describe('integration registry', () => {
  it('exposes PhonePe and lists it before Razorpay', () => {
    expect(PROVIDERS.PHONEPE).toBeDefined();
    expect(PROVIDER_LIST.map((p) => p.key)).toContain('PHONEPE');
    expect(PROVIDER_LIST[0].key).toBe('PHONEPE');
  });

  it('asks for the V2 OAuth fields, marking the right ones secret', () => {
    const fields = PROVIDERS.PHONEPE.fields;
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(
      ['clientId', 'clientSecret', 'clientVersion', 'env', 'webhookPassword', 'webhookUsername'].sort(),
    );
    expect(byKey.clientId.required).toBe(true);
    expect(byKey.clientSecret.secret).toBe(true);
    expect(byKey.webhookPassword.secret).toBe(true);
    // The client id is not itself a secret, so it stays readable in summaries.
    expect(byKey.clientId.secret).toBeFalsy();
  });

  it('tells the admin the exact webhook URL and the events to subscribe to', () => {
    const hint = PROVIDERS.PHONEPE.fields.find((f) => f.key === 'webhookUsername')!.hint!;
    expect(hint).toContain('/api/payments/phonepe/webhook');
    expect(hint).toContain('checkout.order.completed');
    expect(hint).toContain('checkout.order.failed');
    expect(hint).toContain('pg.refund.completed');
    expect(hint).toContain('pg.refund.failed');
    expect(hint).toContain('SHA');
  });

  it('warns that V1 salt-key credentials will not work', () => {
    const hint = PROVIDERS.PHONEPE.fields.find((f) => f.key === 'clientId')!.hint!;
    expect(hint).toMatch(/V2/);
    expect(hint).toMatch(/Salt Key/i);
  });

  it('masks every secret in the stored summary', () => {
    const summary = PROVIDERS.PHONEPE.buildSummary({
      clientId: 'SU2ABCDEFGH',
      clientSecret: 'super-secret-value',
      clientVersion: '1',
      env: 'production',
      webhookUsername: 'hookuser',
      webhookPassword: 'hookpass-secret',
    });
    expect(summary.clientId).toBe('SU2ABCDEFGH');
    expect(summary.env).toBe('PRODUCTION');
    expect(String(summary.clientSecret)).not.toContain('super-secret-value');
    expect(String(summary.webhookPassword)).not.toContain('hookpass-secret');
  });

  it('reports "(not set)" rather than a mask when webhook creds are absent', () => {
    const summary = PROVIDERS.PHONEPE.buildSummary({ clientId: 'A', clientSecret: 'B' });
    expect(summary.webhookUsername).toBe('(not set)');
    expect(summary.webhookPassword).toBe('(not set)');
  });
});
