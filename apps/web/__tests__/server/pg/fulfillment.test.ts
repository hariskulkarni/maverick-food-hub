import { describe, it, expect, vi, beforeEach } from 'vitest';
// Exceptions module routed through the fake client's upsert so assertions on the stored row hold.
vi.mock('@/server/pg/exceptions', () => ({
  openException: async (client: any, input: any) => {
    const row = await client.pgReconException.upsert({ where: { dedupeKey: input.dedupeKey }, create: input, update: {} });
    return { id: row?.id ?? input.dedupeKey, created: true };
  },
}));


const h = vi.hoisted(() => {
  class OrderTransitionError extends Error {}
  return {
    OrderTransitionError,
    transitionOrder: vi.fn(),
    maybeAutoAccept: vi.fn(),
    prisma: {
      pgPaymentAttempt: { findUnique: vi.fn() },
      order: { findUnique: vi.fn() },
      orderStatusEvent: { findFirst: vi.fn() },
      pgReconException: { upsert: vi.fn(), count: vi.fn() },
    },
  };
});

vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/orders', () => ({
  OrderTransitionError: h.OrderTransitionError,
  transitionOrder: h.transitionOrder,
  maybeAutoAccept: h.maybeAutoAccept,
}));

import { handleOrderRelease } from '@/server/pg/fulfillment';

const payload = { orderId: 'o1', attemptId: 'a1', paymentId: 'p1' };
const attempt = (o: Record<string, unknown> = {}) => ({
  id: 'a1',
  orderId: 'o1',
  paymentId: 'p1',
  restaurantId: 'r1',
  receivingAccountId: 'ra1',
  expectedAmountPaise: 45000,
  state: 'CAPTURED',
  payment: { status: 'CAPTURED' },
  ...o,
});
const order = (status: string, createdAt = new Date()) => ({ status, createdAt, branch: { restaurantId: 'r1' } });

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.pgPaymentAttempt.findUnique.mockResolvedValue(attempt());
  h.prisma.orderStatusEvent.findFirst.mockResolvedValue(null);
  h.prisma.pgReconException.upsert.mockResolvedValue({ id: 'x1' });
  h.prisma.pgReconException.count.mockResolvedValue(0);
  h.transitionOrder.mockResolvedValue({});
  h.maybeAutoAccept.mockResolvedValue(undefined);
});

describe('handleOrderRelease', () => {
  it('PAYMENT_PENDING -> RECEIVED via transitionOrder(pgRelease) and runs auto-accept policy', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING'));
    const r = await handleOrderRelease(payload);
    expect(r).toEqual({ outcome: 'RELEASED', orderId: 'o1' });
    expect(h.transitionOrder).toHaveBeenCalledTimes(1);
    expect(h.transitionOrder).toHaveBeenCalledWith('o1', 'RECEIVED', expect.objectContaining({ pgRelease: true }));
    expect(h.maybeAutoAccept).toHaveBeenCalledWith('o1', 'r1');
    expect(h.prisma.pgReconException.upsert).not.toHaveBeenCalled();
  });

  it.each(['RECEIVED', 'ACCEPTED', 'PREPARING', 'DELIVERED'])('already %s -> no-op success, no transition', async (s) => {
    h.prisma.order.findUnique.mockResolvedValue(order(s));
    const r = await handleOrderRelease(payload);
    expect(r).toMatchObject({ outcome: 'ALREADY_RELEASED', orderStatus: s });
    expect(h.transitionOrder).not.toHaveBeenCalled();
    expect(h.prisma.pgReconException.upsert).not.toHaveBeenCalled();
  });

  it('retry after a crash before auto-accept: RECEIVED re-applies the (idempotent) auto-accept policy only', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('RECEIVED'));
    await handleOrderRelease(payload);
    expect(h.maybeAutoAccept).toHaveBeenCalledWith('o1', 'r1');
    expect(h.transitionOrder).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN', 'PAYMENT_FAILED', 'CANCELLED'])(
    '%s before payment -> NOT released, LATE_PAYMENT exception upserted on attempt dedupeKey',
    async (s) => {
      h.prisma.order.findUnique.mockResolvedValue(order(s));
      const r = await handleOrderRelease(payload);
      expect(r).toMatchObject({ outcome: 'LATE_PAYMENT', orderStatus: s, exceptionDedupeKey: 'LATE_PAYMENT:a1' });
      expect(h.transitionOrder).not.toHaveBeenCalled();
      expect(h.maybeAutoAccept).not.toHaveBeenCalled();
      const arg = h.prisma.pgReconException.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ dedupeKey: 'LATE_PAYMENT:a1' });
      expect(arg.create).toMatchObject({ kind: 'LATE_PAYMENT', attemptId: 'a1', orderId: 'o1', restaurantId: 'r1', amountPaise: 45000 });
      expect(arg.update).toEqual({});
    },
  );

  it('cancelled AFTER an earlier release -> no-op (refund flow owns it), no exception', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('CANCELLED_BY_RESTAURANT'));
    h.prisma.orderStatusEvent.findFirst.mockResolvedValue({ id: 'ev1' });
    const r = await handleOrderRelease(payload);
    expect(r.outcome).toBe('ALREADY_RELEASED');
    expect(h.prisma.pgReconException.upsert).not.toHaveBeenCalled();
  });

  it('lost a concurrent race (another worker released) -> re-reads and no-ops', async () => {
    h.prisma.order.findUnique.mockResolvedValueOnce(order('PAYMENT_PENDING')).mockResolvedValueOnce(order('RECEIVED'));
    h.transitionOrder.mockRejectedValueOnce(new h.OrderTransitionError('Order was changed concurrently; please retry.'));
    const r = await handleOrderRelease(payload);
    expect(r.outcome).toBe('ALREADY_RELEASED');
    expect(h.transitionOrder).toHaveBeenCalledTimes(1);
  });

  it('lost a race to a customer cancel -> LATE_PAYMENT, never released', async () => {
    h.prisma.order.findUnique.mockResolvedValueOnce(order('PAYMENT_PENDING')).mockResolvedValueOnce(order('CANCELLED_BY_CUSTOMER'));
    h.transitionOrder.mockRejectedValueOnce(new h.OrderTransitionError('Order was changed concurrently; please retry.'));
    const r = await handleOrderRelease(payload);
    expect(r.outcome).toBe('LATE_PAYMENT');
  });

  it('transient DB error rethrows so the outbox retries', async () => {
    h.prisma.order.findUnique.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    await expect(handleOrderRelease(payload)).rejects.toThrow(/Connection terminated/);
  });

  it('transient error inside transitionOrder rethrows (not swallowed)', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING'));
    h.transitionOrder.mockRejectedValue(new Error('deadlock detected'));
    await expect(handleOrderRelease(payload)).rejects.toThrow(/deadlock/);
    expect(h.maybeAutoAccept).not.toHaveBeenCalled();
  });

  it('exception insert failure rethrows (retry), so a late payment is never silently dropped', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('CANCELLED_BY_CUSTOMER'));
    h.prisma.pgReconException.upsert.mockRejectedValue(new Error('timeout'));
    await expect(handleOrderRelease(payload)).rejects.toThrow(/timeout/);
  });

  it.each([
    ['attempt not CAPTURED', { state: 'OBSERVED' }],
    ['payment not CAPTURED', { payment: { status: 'PENDING' } }],
    ['attempt belongs to another order', { orderId: 'o2' }],
    ['attempt belongs to another payment', { paymentId: 'p2' }],
  ])('refuses to release when %s', async (_n, o) => {
    h.prisma.pgPaymentAttempt.findUnique.mockResolvedValue(attempt(o));
    h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING'));
    await expect(handleOrderRelease(payload)).rejects.toThrow(/ORDER_RELEASE/);
    expect(h.transitionOrder).not.toHaveBeenCalled();
  });

  it('missing attempt or malformed payload throws', async () => {
    h.prisma.pgPaymentAttempt.findUnique.mockResolvedValue(null);
    await expect(handleOrderRelease(payload)).rejects.toThrow(/not found/);
    await expect(handleOrderRelease({ orderId: 'o1' } as any)).rejects.toThrow(/payload/);
  });

  // Round-2 P1-6.
  it('capture long after placement -> held for the restaurant (RELEASE_HELD), no transition, no auto-accept', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING', new Date(Date.now() - 2 * 3_600_000)));
    const r = await handleOrderRelease(payload);
    expect(r).toMatchObject({ outcome: 'HELD_FOR_RESTAURANT', exceptionDedupeKey: 'RELEASE_HELD:stale:o1' });
    expect(h.transitionOrder).not.toHaveBeenCalled();
    expect(h.maybeAutoAccept).not.toHaveBeenCalled();
    expect(h.prisma.pgReconException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ kind: 'RELEASE_HELD', orderId: 'o1' }) }),
    );
  });

  it('restaurant-confirmed release (accepted late payment) skips the stale hold and auto-accept', async () => {
    h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING', new Date(Date.now() - 5 * 3_600_000)));
    const r = await handleOrderRelease({ ...payload, restaurantConfirmedById: 'u-admin' });
    expect(r).toEqual({ outcome: 'RELEASED', orderId: 'o1' });
    expect(h.transitionOrder).toHaveBeenCalledWith('o1', 'RECEIVED', expect.objectContaining({ pgRelease: true, actorId: 'u-admin' }));
    expect(h.maybeAutoAccept).not.toHaveBeenCalled();
  });

  it('respects FLAVRLY_PG_STALE_RELEASE_MINUTES', async () => {
    process.env.FLAVRLY_PG_STALE_RELEASE_MINUTES = '600';
    try {
      h.prisma.order.findUnique.mockResolvedValue(order('PAYMENT_PENDING', new Date(Date.now() - 2 * 3_600_000)));
      expect((await handleOrderRelease(payload)).outcome).toBe('RELEASED');
    } finally {
      delete process.env.FLAVRLY_PG_STALE_RELEASE_MINUTES;
    }
  });
});
