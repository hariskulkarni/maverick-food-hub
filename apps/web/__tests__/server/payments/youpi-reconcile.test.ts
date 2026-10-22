import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    payment: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  } as any,
  status: vi.fn(),
  cfg: vi.fn(),
  transition: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: h.warn, error: vi.fn() } }));
vi.mock('@/server/payments/youpi-api', () => ({ getYoupiStatus: h.status }));
vi.mock('@/server/payments/youpi', () => ({ resolveYoupiConfig: h.cfg, YOUPI_PROVIDER_NAME: 'youpi' }));
vi.mock('@/server/orders', () => ({ transitionOrder: h.transition }));

import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';

const pay = (over: any = {}) => ({
  id: 'p1',
  orderId: 'o1',
  status: 'PENDING',
  amount: '250.00',
  providerRef: 'yp_1',
  order: { id: 'o1', status: 'PAYMENT_PENDING', branch: { restaurantId: 'r1' } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.db.payment.findUnique.mockResolvedValue(pay());
  h.db.payment.findFirst.mockResolvedValue(null);
  h.db.payment.updateMany.mockResolvedValue({ count: 1 });
  h.cfg.mockResolvedValue({ baseUrl: 'x', merchantId: 'm', webhookSecret: 'w' });
  h.transition.mockResolvedValue(undefined);
});

describe('reconcileYoupiPayment', () => {
  it('captures on CAPTURED + utr + exact amount (single-winner) and transitions order', async () => {
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTR1', amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'CAPTURED', captured: true });
    const arg = h.db.payment.updateMany.mock.calls[0][0];
    expect(arg.where.id).toBe('p1');
    expect(arg.where.status.in).toEqual(['PENDING', 'AUTHORIZED', 'FAILED']);
    expect(arg.data.status).toBe('CAPTURED');
    expect(h.transition).toHaveBeenCalledWith('o1', 'RECEIVED', { note: 'Payment captured (Flavrly PG)' });
  });

  it('does not transition when another writer already won (count 0)', async () => {
    h.db.payment.updateMany.mockResolvedValue({ count: 0 });
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTR1', amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r.captured).toBe(false);
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('CAPTURED but amount mismatch -> PENDING, no capture, warns', async () => {
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTR1', amountPaise: 24999 });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false });
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(expect.any(Object), 'youpi.reconcile.amount_or_utr_mismatch');
  });

  it('CAPTURED but amount missing -> PENDING', async () => {
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTR1', amountPaise: null });
    const r = await reconcileYoupiPayment('p1');
    expect(r.status).toBe('PENDING');
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], ['']])('CAPTURED but utr=%s -> PENDING, no capture', async (utr) => {
    h.status.mockResolvedValue({ status: 'CAPTURED', utr, amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false });
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalled();
  });

  it('refuses to capture when another payment on the order is already CAPTURED', async () => {
    h.db.payment.findFirst.mockResolvedValue({ id: 'p0' });
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTR1', amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r.captured).toBe(false);
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('FAILED -> marks FAILED from PENDING/AUTHORIZED only', async () => {
    h.status.mockResolvedValue({ status: 'FAILED' });
    const r = await reconcileYoupiPayment('p1');
    expect(r.status).toBe('FAILED');
    const arg = h.db.payment.updateMany.mock.calls[0][0];
    expect(arg.where.status.in).toEqual(['PENDING', 'AUTHORIZED']);
    expect(arg.data.status).toBe('FAILED');
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('UNKNOWN / PENDING -> stays PENDING, no writes', async () => {
    for (const st of ['UNKNOWN', 'PENDING']) {
      h.status.mockResolvedValue({ status: st });
      const r = await reconcileYoupiPayment('p1');
      expect(r.status).toBe('PENDING');
    }
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('already CAPTURED/REFUNDED -> short-circuits without gateway call', async () => {
    for (const st of ['CAPTURED', 'REFUNDED']) {
      h.db.payment.findUnique.mockResolvedValue(pay({ status: st }));
      const r = await reconcileYoupiPayment('p1');
      expect(r).toMatchObject({ status: st, captured: false });
    }
    expect(h.status).not.toHaveBeenCalled();
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('no config -> PENDING without gateway call', async () => {
    h.cfg.mockResolvedValue(null);
    const r = await reconcileYoupiPayment('p1');
    expect(r.status).toBe('PENDING');
    expect(h.status).not.toHaveBeenCalled();
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });
});
