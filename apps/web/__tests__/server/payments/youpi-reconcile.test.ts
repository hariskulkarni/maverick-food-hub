import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const db: any = {
    payment: { findUnique: vi.fn(), updateMany: vi.fn() },
    pgPaymentAttempt: { update: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(async () => 0) },
    pgAllocation: { count: vi.fn() },
    $queryRaw: vi.fn(),
  };
  db.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(db));
  return {
    db,
    status: vi.fn(),
    cfg: vi.fn(),
    warn: vi.fn(),
    observe: vi.fn(),
    allocate: vi.fn(),
    openException: vi.fn(),
    appendEvent: vi.fn(),
    releaseLimit: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
});

vi.mock('@/server/db', () => ({ prisma: h.db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: h.warn, error: vi.fn() } }));
vi.mock('@/server/payments/youpi-api', () => ({ getYoupiStatus: h.status }));
vi.mock('@/server/payments/youpi', () => ({ resolveYoupiConfig: h.cfg, YOUPI_PROVIDER_NAME: 'youpi' }));
vi.mock('@/server/pg/reconcile-engine', () => ({ recordObservation: h.observe, tryAllocateForAttempt: h.allocate }));
vi.mock('@/server/pg/exceptions', () => ({ openException: h.openException }));
vi.mock('@/server/pg/ledger', () => ({ appendFinancialEvent: h.appendEvent }));
vi.mock('@/server/pg/limits', () => ({ releaseLimit: h.releaseLimit }));
vi.mock('@/server/payments/reconcile', () => ({ markOrderPaymentFailed: h.markFailed }));

import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';

const attempt = (over: any = {}) => ({
  id: 'a1',
  orderId: 'o1',
  restaurantId: 'r1',
  receivingAccountId: 'acc1',
  gatewayPaymentId: 'yp_1',
  state: 'AWAITING_PAYMENT',
  observedUtr: null,
  ...over,
});

const pay = (over: any = {}) => ({
  id: 'p1',
  orderId: 'o1',
  status: 'PENDING',
  amount: '250.00',
  providerRef: 'yp_1',
  order: { id: 'o1', status: 'PAYMENT_PENDING', branch: { restaurantId: 'r1' } },
  pgAttempt: attempt(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.db.payment.findUnique.mockImplementation(async (args: any) => (args.select ? { status: 'PENDING' } : pay()));
  h.db.payment.updateMany.mockResolvedValue({ count: 1 });
  h.db.pgPaymentAttempt.update.mockResolvedValue({});
  h.db.pgPaymentAttempt.findUniqueOrThrow.mockResolvedValue(attempt());
  h.db.pgAllocation.count.mockResolvedValue(0);
  h.cfg.mockResolvedValue({ baseUrl: 'x', merchantId: 'm', webhookSecret: 'w' });
  h.observe.mockResolvedValue({ evidenceId: 'e1', duplicate: false, state: 'OBSERVED', observedUtr: null });
  h.allocate.mockResolvedValue({ outcome: 'NO_CANDIDATE' });
  h.openException.mockResolvedValue({ id: 'x1', created: true });
});

describe('reconcileYoupiPayment (status SUCCESS = observation only)', () => {
  it('SUCCESS records authenticated GATEWAY_STATUS evidence and reports CAPTURED only when the engine allocated a bank credit', async () => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 25000 });
    h.allocate.mockResolvedValue({ outcome: 'CAPTURED', allocationId: 'al1' });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'CAPTURED', captured: true });
    expect(h.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'a1',
        source: 'GATEWAY_STATUS',
        utr: 'UTR1',
        amountPaise: 25000,
        authenticated: true,
        dedupeKey: 'GATEWAY_STATUS:a1:SUCCESS',
      }),
    );
    expect(h.allocate).toHaveBeenCalledWith('a1');
    // The capture itself is written by the engine, never here.
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('SUCCESS + exact amount + UTR but no bank credit yet -> stays PENDING (no capture from status)', async () => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false });
    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('a concurrent engine run already captured -> CAPTURED but captured=false', async () => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 25000 });
    h.allocate.mockResolvedValue({ outcome: 'ALREADY_ALLOCATED' });
    h.db.payment.findUnique.mockImplementation(async (args: any) => (args.select ? { status: 'CAPTURED' } : pay()));
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'CAPTURED', captured: false });
  });

  it('SUCCESS with amount mismatch is passed to the engine as evidence; result stays PENDING', async () => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 24999 });
    h.allocate.mockResolvedValue({ outcome: 'REJECTED', reason: 'amount differs from expected' });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false });
    expect(h.observe).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 24999 }));
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined]])('SUCCESS without UTR (utr=%s) is still recorded; no capture', async (utr) => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr, amountPaise: 25000 });
    h.allocate.mockResolvedValue({ outcome: 'NO_UTR' });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false });
    expect(h.observe).toHaveBeenCalledWith(expect.objectContaining({ utr: null }));
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });

  it('order already paid by another credit -> engine OVERCOLLECTION -> PENDING, no capture here', async () => {
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 25000 });
    h.allocate.mockResolvedValue({ outcome: 'OVERCOLLECTION', allocationId: 'al2' });
    const r = await reconcileYoupiPayment('p1');
    expect(r.captured).toBe(false);
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('reconcileYoupiPayment (FAILED)', () => {
  it('FAILED on a never-observed attempt without allocation -> attempt FAILED + Payment FAILED from PENDING/AUTHORIZED', async () => {
    h.status.mockResolvedValue({ status: 'FAILED' });
    const r = await reconcileYoupiPayment('p1');
    expect(r.status).toBe('FAILED');
    const arg = h.db.payment.updateMany.mock.calls[0][0];
    expect(arg.where.status.in).toEqual(['PENDING', 'AUTHORIZED']);
    expect(arg.data.status).toBe('FAILED');
    expect(h.db.pgPaymentAttempt.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { state: 'FAILED' } });
    expect(h.appendEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ATTEMPT_FAILED' }));
    // P0-4: gateway-confirmed dead session frees the limit and, with no other live attempt, fails the order.
    expect(h.releaseLimit).toHaveBeenCalledWith(expect.anything(), 'a1');
    expect(h.markFailed).toHaveBeenCalledWith('o1', expect.stringContaining('failed'));
  });

  it('FAILED after the attempt was OBSERVED -> stays PENDING, exception for an operator', async () => {
    h.status.mockResolvedValue({ status: 'FAILED' });
    h.db.pgPaymentAttempt.findUniqueOrThrow.mockResolvedValue(attempt({ state: 'OBSERVED', observedUtr: 'UTR1' }));
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false, indeterminate: true });
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
    expect(h.openException).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'STALE_PENDING' }));
  });

  it('FAILED while an allocation exists -> stays PENDING', async () => {
    h.status.mockResolvedValue({ status: 'FAILED' });
    h.db.pgAllocation.count.mockResolvedValue(1);
    const r = await reconcileYoupiPayment('p1');
    expect(r.status).toBe('PENDING');
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('reconcileYoupiPayment (guards)', () => {
  it('UNKNOWN / PENDING -> stays PENDING, no payment writes, no evidence', async () => {
    for (const st of ['UNKNOWN', 'PENDING']) {
      h.status.mockResolvedValue({ status: st });
      const r = await reconcileYoupiPayment('p1');
      expect(r.status).toBe('PENDING');
    }
    expect(h.db.payment.updateMany).not.toHaveBeenCalled();
    expect(h.observe).not.toHaveBeenCalled();
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

  it('legacy youpi payment without PgPaymentAttempt is never auto-captured: STALE_PENDING exception, no gateway call', async () => {
    h.db.payment.findUnique.mockResolvedValue(pay({ pgAttempt: null }));
    h.status.mockResolvedValue({ status: 'OBSERVED', utr: 'UTR1', amountPaise: 25000 });
    const r = await reconcileYoupiPayment('p1');
    expect(r).toMatchObject({ status: 'PENDING', captured: false, indeterminate: true });
    expect(h.status).not.toHaveBeenCalled();
    expect(h.observe).not.toHaveBeenCalled();
    expect(h.openException).toHaveBeenCalledWith(
      h.db,
      expect.objectContaining({ kind: 'STALE_PENDING', dedupeKey: 'STALE_PENDING:legacy:p1' }),
    );
  });
});
