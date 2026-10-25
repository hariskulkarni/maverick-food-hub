import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sms: vi.fn(),
  email: vi.fn(),
  sendWebPush: vi.fn(),
  prisma: {
    order: { findUnique: vi.fn(), updateMany: vi.fn() },
    orderFeedback: { findUnique: vi.fn() },
    webPushSubscription: { count: vi.fn() },
    reviewRequest: { update: vi.fn(), create: vi.fn(), count: vi.fn() },
    reviewRequestConfig: { findUnique: vi.fn() },
    reviewRequestOptOut: { count: vi.fn() },
    serviceRecoveryTicket: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    alertDebounce: { findUnique: vi.fn(), upsert: vi.fn() },
    restaurant: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    branch: { findUnique: vi.fn() },
  },
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms, email: h.email } }));
vi.mock('@/server/push/webpush', () => ({ sendWebPush: h.sendWebPush }));

import { onOrderFeedbackSaved, openRecoveryTicket, minutesLate } from '@/server/reviews/recovery';
import { scheduleReviewRequest, funnelStats } from '@/server/reviews/acquisition';
import { requestFeedbackOnDelivered } from '@/server/reviews/feedback-request';

const cfg = (over = {}) => ({ enabled: true, channels: ['SMS'], delayMinutes: 45, lowRatingThreshold: 3, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfg());
  h.prisma.order.findUnique.mockResolvedValue({
    branch: { restaurantId: 'r1' }, customer: { name: 'Asha', phone: '+919900000000' }, reviewRequest: { id: 'rr1', feedbackAt: null },
  });
  h.prisma.serviceRecoveryTicket.findUnique.mockResolvedValue(null);
  h.prisma.serviceRecoveryTicket.create.mockResolvedValue({ id: 't1', restaurant: { name: 'Spice Hub' }, order: { code: 'ORD-1' } });
  h.prisma.serviceRecoveryTicket.count.mockResolvedValue(1);
  h.prisma.alertDebounce.findUnique.mockResolvedValue(null);
  h.prisma.restaurant.findUnique.mockResolvedValue({ owner: { email: 'o@x.in', phone: '+911111111111' }, members: [], contactEmail: null, contactPhone: null });
  h.prisma.user.findMany.mockResolvedValue([]);
  h.sms.mockResolvedValue({ ok: true });
  h.email.mockResolvedValue({ ok: true });
});

describe('onOrderFeedbackSaved', () => {
  it('stamps the ReviewRequest and opens a ticket for a low rating, alerting the owner', async () => {
    const r = await onOrderFeedbackSaved({ orderId: 'o1', customerId: 'u1', overallRating: 2, comment: 'late' });
    expect(r.ticketOpened).toBe(true);
    expect(h.prisma.reviewRequest.update).toHaveBeenCalledWith({ where: { id: 'rr1' }, data: { feedbackAt: expect.any(Date), status: 'FEEDBACK', reminderDueAt: null } });
    expect(h.prisma.serviceRecoveryTicket.create.mock.calls[0][0].data).toMatchObject({
      restaurantId: 'r1', orderId: 'o1', rating: 2, comment: 'late', contactPhone: '+919900000000', reviewRequestId: 'rr1',
    });
    expect(h.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'o@x.in', template: 'alert.review.recovery' }));
    expect(h.sms).toHaveBeenCalledWith(expect.objectContaining({ to: '+911111111111' }));
    expect(h.email.mock.calls[0][0].body).toMatch(/unconditional/i);
  });

  it('does not open a ticket above the threshold (configurable)', async () => {
    expect((await onOrderFeedbackSaved({ orderId: 'o1', customerId: 'u1', overallRating: 4 })).ticketOpened).toBe(false);
    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfg({ lowRatingThreshold: 4 }));
    expect((await onOrderFeedbackSaved({ orderId: 'o1', customerId: 'u1', overallRating: 4 })).ticketOpened).toBe(true);
  });

  it('never throws', async () => {
    h.prisma.order.findUnique.mockRejectedValue(new Error('db down'));
    await expect(onOrderFeedbackSaved({ orderId: 'o1', customerId: 'u1', overallRating: 1 })).resolves.toEqual({ ticketOpened: false });
  });
});

describe('openRecoveryTicket', () => {
  it('is one ticket per order: a repeat updates the rating instead of duplicating', async () => {
    h.prisma.serviceRecoveryTicket.findUnique.mockResolvedValue({ id: 't1' });
    const r = await openRecoveryTicket({ restaurantId: 'r1', orderId: 'o1', rating: 1, comment: 'worse' });
    expect(r).toEqual({ created: false, id: 't1' });
    expect(h.prisma.serviceRecoveryTicket.create).not.toHaveBeenCalled();
    expect(h.prisma.serviceRecoveryTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { rating: 1, comment: 'worse' } });
  });

  it('debounces the owner alert per restaurant', async () => {
    h.prisma.alertDebounce.findUnique.mockResolvedValue({ lastSentAt: new Date() });
    await openRecoveryTicket({ restaurantId: 'r1', orderId: 'o2', rating: 2 });
    expect(h.prisma.serviceRecoveryTicket.create).toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
  });
});

describe('minutesLate', () => {
  it('reports positive lateness only', () => {
    const eta = new Date('2026-10-24T12:00:00Z');
    expect(minutesLate({ estimatedDeliveryAt: eta, deliveredAt: new Date('2026-10-24T12:25:00Z') })).toBe(25);
    expect(minutesLate({ estimatedDeliveryAt: eta, deliveredAt: new Date('2026-10-24T11:50:00Z') })).toBeNull();
    expect(minutesLate({ estimatedDeliveryAt: null, deliveredAt: eta })).toBeNull();
  });
});

describe('scheduling on DELIVERED', () => {
  it('queues one ask at delivered + delay; duplicate is a no-op', async () => {
    const d = new Date('2026-10-24T10:00:00Z');
    expect(await scheduleReviewRequest({ orderId: 'o1', restaurantId: 'r1', customerId: 'u1', deliveredAt: d })).toBe(true);
    expect(h.prisma.reviewRequest.create.mock.calls[0][0].data).toMatchObject({ orderId: 'o1', status: 'SCHEDULED', dueAt: new Date('2026-10-24T10:45:00Z') });
    h.prisma.reviewRequest.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(scheduleReviewRequest({ orderId: 'o1', restaurantId: 'r1', customerId: 'u1', deliveredAt: d })).resolves.toBe(true);
  });

  it('does nothing when the restaurant has not enabled review requests', async () => {
    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(null);
    expect(await scheduleReviewRequest({ orderId: 'o1', restaurantId: 'r1', customerId: 'u1', deliveredAt: new Date() })).toBe(false);
    expect(h.prisma.reviewRequest.create).not.toHaveBeenCalled();
  });

  it('requestFeedbackOnDelivered replaces the untracked SMS with the scheduled ask', async () => {
    h.prisma.orderFeedback.findUnique.mockResolvedValue(null);
    h.prisma.order.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.webPushSubscription.count.mockResolvedValue(0);
    await requestFeedbackOnDelivered({ orderId: 'o1', code: 'ORD-1', customerId: 'u1', phone: '+91', restaurantId: 'r1', feedbackRequestedAt: null });
    expect(h.prisma.reviewRequest.create).toHaveBeenCalledTimes(1);
    expect(h.sms).not.toHaveBeenCalled();

    h.prisma.reviewRequestConfig.findUnique.mockResolvedValue(cfg({ enabled: false }));
    await requestFeedbackOnDelivered({ orderId: 'o2', code: 'ORD-2', customerId: 'u1', phone: '+91', restaurantId: 'r1', feedbackRequestedAt: null });
    expect(h.sms).toHaveBeenCalledTimes(1);
  });
});

describe('funnelStats', () => {
  it('counts the last 30 days from the logs', async () => {
    h.prisma.reviewRequest.count.mockResolvedValueOnce(10).mockResolvedValueOnce(6).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    h.prisma.reviewRequestOptOut.count.mockResolvedValue(1);
    const now = new Date('2026-10-24T00:00:00Z');
    const s = await funnelStats('r1', now);
    expect(s).toMatchObject({ sent: 10, clicked: 6, feedback: 4, googleClicks: 3, optOuts: 1, qrScans: 2 });
    const sentWhere = h.prisma.reviewRequest.count.mock.calls[0][0].where;
    expect(sentWhere).toMatchObject({ restaurantId: 'r1', channel: { not: 'QR' } });
    expect(sentWhere.sentAt.gte.toISOString()).toBe('2026-09-24T00:00:00.000Z');
    expect(h.prisma.reviewRequestOptOut.count.mock.calls[0][0].where).toMatchObject({ sourceRestaurantId: 'r1' });
  });
});
