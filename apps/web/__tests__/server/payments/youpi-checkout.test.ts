import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  } as any,
  paymentProvider: vi.fn(),
  youpiEnabled: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/payments/index', () => ({
  paymentProvider: h.paymentProvider,
  youpiEnabledForRestaurant: h.youpiEnabled,
}));

import { startOnlinePayment } from '@/server/payments/online';

const order = (over: any = {}) => ({
  id: 'o1',
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
});

describe('startOnlinePayment — YouPI rail', () => {
  it('persists a PENDING youpi Payment with providerRef = YouPI paymentId and returns the checkoutUrl', async () => {
    const s = await startOnlinePayment('o1', { rail: 'youpi' });

    expect(h.paymentProvider).toHaveBeenCalledWith('r1', { prefer: 'youpi' });
    expect(h.db.payment.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'o1',
      status: 'PENDING',
      providerName: 'youpi',
    });
    const upd = h.db.payment.update.mock.calls.at(-1)![0];
    expect(upd.where).toEqual({ id: 'pay1' });
    expect(upd.data.providerName).toBe('youpi');
    expect(upd.data.providerRef).toBe('yp_123');
    expect(upd.data.status).toBeUndefined(); // stays PENDING
    expect(s.providerName).toBe('youpi');
    expect(s.providerOrderId).toBe('yp_123');
    expect(s.redirectUrl).toBe('https://youpi.example/checkout/yp_123');
  });

  it('never marks the order or payment paid on create', async () => {
    await startOnlinePayment('o1', { rail: 'youpi' });
    expect(h.db.order.update).not.toHaveBeenCalled();
    expect(h.db.order.updateMany).not.toHaveBeenCalled();
    for (const c of [...h.db.payment.create.mock.calls, ...h.db.payment.update.mock.calls]) {
      const st = (c[0].data as any).status;
      expect(st === undefined || st === 'PENDING').toBe(true);
      expect(st).not.toBe('CAPTURED');
    }
  });

  it('does not take the YouPI branch when not enabled for the restaurant', async () => {
    h.youpiEnabled.mockResolvedValue(false);
    await expect(startOnlinePayment('o1', { rail: 'youpi' })).rejects.toThrow(/YouPI/);
    expect(h.paymentProvider).not.toHaveBeenCalled();
    expect(h.db.payment.create).not.toHaveBeenCalled();
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
  });
});

describe('YouPI return URL guard', () => {
  it('throws OnlinePaymentError when brand.url is unset', async () => {
    vi.resetModules();
    vi.doMock('@/lib/brand', () => ({ brand: { url: '' } }));
    const mod = await import('@/server/payments/online');
    await expect(mod.startOnlinePayment('o1', { rail: 'youpi' } as any)).rejects.toThrow(/brand\.url missing/);
    expect(h.db.payment.create).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/brand');
  });
});
