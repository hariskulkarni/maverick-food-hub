import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sendWebPush: vi.fn(),
  prisma: { webPushSubscription: { count: vi.fn() } }
}));
vi.mock('@/server/push/webpush', () => ({ sendWebPush: h.sendWebPush }));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));

import { pushOrderMilestone, MILESTONE_STATUSES } from '@/server/push/milestones';

beforeEach(() => {
  h.sendWebPush.mockReset().mockResolvedValue(undefined);
  h.prisma.webPushSubscription.count.mockReset();
});

describe('pushOrderMilestone', () => {
  it('maps the five customer milestones', () => {
    expect([...MILESTONE_STATUSES].sort()).toEqual(
      ['ACCEPTED', 'DELIVERED', 'OUT_FOR_DELIVERY', 'PREPARING', 'RIDER_REACHED_CUSTOMER'].sort()
    );
  });

  it.each(['ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'RIDER_REACHED_CUSTOMER', 'DELIVERED'])(
    'sends web push for %s when the user has a subscription',
    async (status) => {
      h.prisma.webPushSubscription.count.mockResolvedValue(1);
      await pushOrderMilestone({ orderId: 'o1', code: 'FL-1', customerId: 'u1', status });
      expect(h.sendWebPush).toHaveBeenCalledTimes(1);
      const [uid, payload] = h.sendWebPush.mock.calls[0];
      expect(uid).toBe('u1');
      expect(payload.url).toBe('/orders/o1');
      expect(payload.tag).toBe('order-o1');
      expect(payload.body).toContain('FL-1');
    }
  );

  it('does not send for a user without a subscription', async () => {
    h.prisma.webPushSubscription.count.mockResolvedValue(0);
    await pushOrderMilestone({ orderId: 'o1', code: 'FL-1', customerId: 'u1', status: 'DELIVERED' });
    expect(h.sendWebPush).not.toHaveBeenCalled();
  });

  it('ignores non-milestone statuses without touching the db', async () => {
    await pushOrderMilestone({ orderId: 'o1', code: 'FL-1', customerId: 'u1', status: 'READY' });
    expect(h.prisma.webPushSubscription.count).not.toHaveBeenCalled();
    expect(h.sendWebPush).not.toHaveBeenCalled();
  });

  it('never throws when sendWebPush fails', async () => {
    h.prisma.webPushSubscription.count.mockResolvedValue(1);
    h.sendWebPush.mockRejectedValue(new Error('boom'));
    await expect(
      pushOrderMilestone({ orderId: 'o1', code: 'FL-1', customerId: 'u1', status: 'PREPARING' })
    ).resolves.toBeUndefined();
  });
});
