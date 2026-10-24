import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    order: { findFirstOrThrow: vi.fn() },
    payment: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn() } }));
vi.mock('@/server/payments', () => ({ youpiEnabledForRestaurant: vi.fn() }));
vi.mock('@/server/payments/online', () => ({ isOnlineMethod: vi.fn(), startOnlinePayment: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { transitionOrder, OrderTransitionError } from '@/server/orders';

const STOP = new Error('__STOP_AT_TX__');

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.$transaction.mockRejectedValue(STOP); // proves the guard let the transition through
});

const withStatus = (status: string) =>
  h.prisma.order.findFirstOrThrow.mockResolvedValue({
    id: 'o1', status, customerId: 'c1', branchId: 'b1', branch: { restaurantId: 'r1', restaurant: { parentId: null } },
  });

describe('transitionOrder Flavrly PG release guard', () => {
  it.each(['PAYMENT_PENDING', 'PAYMENT_FAILED'])('manual %s -> RECEIVED on a youpi order is refused', async (s) => {
    withStatus(s);
    h.prisma.payment.count.mockResolvedValue(1);
    await expect(transitionOrder('o1', 'RECEIVED' as any, { actorId: 'admin1' })).rejects.toBeInstanceOf(OrderTransitionError);
    expect(h.prisma.payment.count).toHaveBeenCalledWith({ where: { orderId: 'o1', providerName: 'youpi' } });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the bank-verified release (pgRelease) passes the guard', async () => {
    withStatus('PAYMENT_PENDING');
    h.prisma.payment.count.mockResolvedValue(1);
    await expect(transitionOrder('o1', 'RECEIVED' as any, { pgRelease: true })).rejects.toBe(STOP);
    expect(h.prisma.payment.count).not.toHaveBeenCalled();
  });

  it('non-youpi (PhonePe/Razorpay) PAYMENT_PENDING -> RECEIVED is unchanged', async () => {
    withStatus('PAYMENT_PENDING');
    h.prisma.payment.count.mockResolvedValue(0);
    await expect(transitionOrder('o1', 'RECEIVED' as any, { note: 'Payment captured (PhonePe)' })).rejects.toBe(STOP);
  });

  it('youpi order cancel from PAYMENT_PENDING is not affected', async () => {
    withStatus('PAYMENT_PENDING');
    await expect(transitionOrder('o1', 'CANCELLED_BY_CUSTOMER' as any)).rejects.toBe(STOP);
    expect(h.prisma.payment.count).not.toHaveBeenCalled();
  });
});
