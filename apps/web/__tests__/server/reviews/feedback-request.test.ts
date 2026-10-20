import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sendWebPush: vi.fn(),
  sms: vi.fn(),
  prisma: {
    orderFeedback: { findUnique: vi.fn() },
    order: { updateMany: vi.fn() },
    webPushSubscription: { count: vi.fn() }
  }
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/push/webpush', () => ({ sendWebPush: h.sendWebPush }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms } }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { requestFeedbackOnDelivered } from '@/server/reviews/feedback-request';

const args = {
  orderId: 'o1', code: 'FL-1', customerId: 'u1', phone: '+911234567890', restaurantId: 'r1',
  feedbackRequestedAt: null as Date | null
};

beforeEach(() => {
  Object.values(h.prisma).forEach((m) => Object.values(m).forEach((f: any) => f.mockReset()));
  h.sendWebPush.mockReset().mockResolvedValue(undefined);
  h.sms.mockReset().mockResolvedValue({ ok: true });
  h.prisma.orderFeedback.findUnique.mockResolvedValue(null);
  h.prisma.order.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.webPushSubscription.count.mockResolvedValue(1);
});

describe('requestFeedbackOnDelivered', () => {
  it('sends push + sms once, linking to the order page, and stamps feedbackRequestedAt', async () => {
    await requestFeedbackOnDelivered(args);
    expect(h.prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', feedbackRequestedAt: null },
      data: { feedbackRequestedAt: expect.any(Date) }
    });
    expect(h.sendWebPush).toHaveBeenCalledTimes(1);
    expect(h.sendWebPush.mock.calls[0][1].url).toBe('/orders/o1');
    expect(h.sms).toHaveBeenCalledTimes(1);
    expect(h.sms.mock.calls[0][0].body).toContain('/orders/o1');
    expect(h.sms.mock.calls[0][0].template).toBe('order.feedback_request');
  });

  it('is not resent when already requested (in-memory or lost claim race)', async () => {
    await requestFeedbackOnDelivered({ ...args, feedbackRequestedAt: new Date() });
    expect(h.sms).not.toHaveBeenCalled();
    h.prisma.order.updateMany.mockResolvedValue({ count: 0 });
    await requestFeedbackOnDelivered(args);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.sendWebPush).not.toHaveBeenCalled();
  });

  it('skips when the order already has feedback', async () => {
    h.prisma.orderFeedback.findUnique.mockResolvedValue({ id: 'f1' });
    await requestFeedbackOnDelivered(args);
    expect(h.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
  });

  it('never throws when sends fail', async () => {
    h.sms.mockRejectedValue(new Error('boom'));
    h.sendWebPush.mockRejectedValue(new Error('boom'));
    await expect(requestFeedbackOnDelivered(args)).resolves.toBeUndefined();
    h.prisma.orderFeedback.findUnique.mockRejectedValue(new Error('db'));
    await expect(requestFeedbackOnDelivered(args)).resolves.toBeUndefined();
  });
});
