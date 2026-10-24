import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  } as any,
  paymentProvider: vi.fn(),
  youpiEnabled: vi.fn(),
  createOrder: vi.fn(),
  createPgAttempt: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/pg/attempts', async () => {
  const real = await vi.importActual<typeof import('@/server/pg/attempts')>('@/server/pg/attempts');
  return { PgAttemptError: real.PgAttemptError, createPgAttempt: h.createPgAttempt };
});
vi.mock('@/server/payments/index', () => ({
  paymentProvider: h.paymentProvider,
  youpiEnabledForRestaurant: h.youpiEnabled,
}));

import { startOnlinePayment } from '@/server/payments/online';
import { PgAttemptError } from '@/server/pg/attempts';

const order = (over: any = {}) => ({
  id: 'o1',
  customerId: 'u1',
  code: 'ORD-1',
  total: '250.00',
  currency: 'INR',
  paymentMethod: 'RAZORPAY',
  customer: { name: 'A', phone: '9999999999', email: null },
  branch: { id: 'b1', restaurantId: 'r1' },
  payments: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.db.order.findUnique.mockResolvedValue(order());
  h.db.payment.create.mockResolvedValue({ id: 'pay1' });
  h.db.payment.update.mockResolvedValue({});
  h.db.payment.updateMany.mockResolvedValue({ count: 0 });
  h.youpiEnabled.mockResolvedValue(true);
  h.createOrder.mockResolvedValue({
    providerName: 'youpi',
    providerOrderId: 'yp_123',
    redirectUrl: 'https://youpi.example/checkout/yp_123',
    amount: 250,
    currency: 'INR',
    raw: { paymentId: 'yp_123' },
  });
  h.paymentProvider.mockResolvedValue({ name: 'youpi', createOrder: h.createOrder });
  h.createPgAttempt.mockResolvedValue({
    paymentId: 'pay1', attemptId: 'a1', attemptKey: 'o1-a1', gatewayPaymentId: 'yp_123',
    checkoutUrl: 'https://youpi.example/checkout/yp_123', expiresAt: new Date(1_900_000_000_000),
    amountPaise: 25000, reused: false,
  });
});

describe('startOnlinePayment — Flavrly PG rail', () => {
  it('delegates to createPgAttempt with exact paise and returns the checkout session', async () => {
    const s = await startOnlinePayment('o1', { rail: 'youpi' });
    expect(h.createPgAttempt).toHaveBeenCalledTimes(1);
    const [ord, opts] = h.createPgAttempt.mock.calls[0];
    expect(ord).toMatchObject({ id: 'o1', restaurantId: 'r1', customerId: 'u1' });
    expect(opts).toMatchObject({ amountPaise: 25000, method: 'RAZORPAY', currency: 'INR' });
    expect(opts.redirectUrl).toMatch(/\/checkout\/payment-status\?orderId=o1&provider=youpi$/);
    expect(s).toEqual({
      paymentId: 'pay1', providerName: 'youpi', providerOrderId: 'yp_123', amount: 250, currency: 'INR',
      redirectUrl: 'https://youpi.example/checkout/yp_123', expireAt: 1_900_000_000_000,
    });
    // No generic gateway path, no Payment rows written here (createPgAttempt owns them).
    expect(h.paymentProvider).not.toHaveBeenCalled();
    expect(h.db.payment.create).not.toHaveBeenCalled();
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('caller-provided amount is converted exactly (no float *100)', async () => {
    await startOnlinePayment('o1', { rail: 'youpi', amount: 1.15 });
    expect(h.createPgAttempt.mock.calls[0][1].amountPaise).toBe(115);
  });

  it('a retry of a youpi order stays on youpi', async () => {
    h.db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'p0', method: 'RAZORPAY', status: 'FAILED', providerName: 'youpi' }] }));
    await startOnlinePayment('o1');
    expect(h.createPgAttempt).toHaveBeenCalled();
    expect(h.paymentProvider).not.toHaveBeenCalled();
  });

  it('maps PgAttemptError to OnlinePaymentError with its HTTP status', async () => {
    h.createPgAttempt.mockRejectedValue(new PgAttemptError('pending elsewhere', 409, 'ATTEMPT_UNRESOLVED'));
    await expect(startOnlinePayment('o1', { rail: 'youpi' })).rejects.toMatchObject({ status: 409, message: 'pending elsewhere' });
  });

  it('never marks the order or payment paid', async () => {
    await startOnlinePayment('o1', { rail: 'youpi' });
    expect(h.db.order.update).not.toHaveBeenCalled();
    expect(h.db.order.updateMany).not.toHaveBeenCalled();
  });

  it('does not take the Flavrly PG branch when not enabled for the restaurant', async () => {
    h.youpiEnabled.mockResolvedValue(false);
    await expect(startOnlinePayment('o1', { rail: 'youpi' })).rejects.toThrow(/Flavrly PG/);
    expect(h.createPgAttempt).not.toHaveBeenCalled();
    expect(h.db.payment.create).not.toHaveBeenCalled();
  });

  it('refuses an already-paid order before touching Flavrly PG', async () => {
    h.db.order.findUnique.mockResolvedValue(order({ payments: [{ id: 'p0', method: 'RAZORPAY', status: 'CAPTURED', providerName: 'youpi' }] }));
    await expect(startOnlinePayment('o1', { rail: 'youpi' })).rejects.toMatchObject({ status: 409 });
    expect(h.createPgAttempt).not.toHaveBeenCalled();
  });

  it('default path (no rail) is unchanged: no prefer option, youpi not consulted', async () => {
    h.paymentProvider.mockResolvedValue({
      name: 'phonepe',
      createOrder: vi.fn().mockResolvedValue({
        providerName: 'phonepe', providerOrderId: 'o1-1', amount: 250, currency: 'INR', raw: {},
      }),
    });
    await startOnlinePayment('o1');
    expect(h.paymentProvider).toHaveBeenCalledWith('r1');
    expect(h.youpiEnabled).not.toHaveBeenCalled();
    expect(h.createPgAttempt).not.toHaveBeenCalled();
  });
});

describe('Flavrly PG return URL guard', () => {
  it('throws OnlinePaymentError when brand.url is unset', async () => {
    vi.resetModules();
    vi.doMock('@/lib/brand', () => ({ brand: { url: '' } }));
    const mod = await import('@/server/payments/online');
    await expect(mod.startOnlinePayment('o1', { rail: 'youpi' } as any)).rejects.toThrow(/brand\.url missing/);
    expect(h.db.payment.create).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/brand');
  });
});
