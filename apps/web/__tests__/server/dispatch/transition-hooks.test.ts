/**
 * transitionOrder ↔ dispatch telemetry: the milestone hook fires with the
 * right source, and the READY branch does not re-push riders JIT already
 * notified nor batch-invite an order a rider already holds. With JIT off and
 * no assignment the legacy behaviour (pool + push + batch) is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hookCalls: any[] = [];
let alreadyNotified = false;
let assigned = false;
const pushed: string[] = [];
const batched: string[] = [];
const published: string[] = [];
let order: any;

vi.mock('@/server/dispatch/hooks', () => ({
  onOrderTransition: async (i: any) => { hookCalls.push(i); },
  onFoodReady: async () => ({ alreadyNotified }),
  hasAssignment: async () => assigned,
}));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: async (id: string) => { pushed.push(id); } }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: async (id: string) => { batched.push(id); return { invited: 0 }; } }));
vi.mock('@/server/realtime', () => ({ publish: (ch: string) => { published.push(ch); } }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/notify-templates', () => ({ sendDeliveryOtpSms: vi.fn(async () => undefined) }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/reviews/feedback-request', () => ({ requestFeedbackOnDelivered: vi.fn(async () => undefined) }));
vi.mock('@/server/signup-bonus', () => ({ restoreSignupBonusForOrder: vi.fn(async () => undefined), commitSignupBonusForOrder: vi.fn(async () => undefined), previewSignupBonusForUser: vi.fn(), holdSignupBonusForOrder: vi.fn() }));
vi.mock('@/server/challenges', () => ({ refreshChallengeProgressForOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/rider-assignment-release', () => ({ releaseAssignmentOnOrderClose: async () => null }));
vi.mock('@/server/payments/online', () => ({ isOnlineMethod: () => false, startOnlinePayment: vi.fn() }));
vi.mock('@/server/db', () => {
  const tx = {
    order: { updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => ({ ...order }) },
    orderStatusEvent: { create: async () => ({}) },
    riderAssignment: { findUnique: async () => null },
  };
  return {
    prisma: {
      order: { findFirstOrThrow: async () => order },
      $transaction: async (fn: any) => fn(tx),
    },
  };
});

import { transitionOrder } from '@/server/orders';

beforeEach(() => {
  hookCalls.length = 0;
  pushed.length = 0;
  batched.length = 0;
  published.length = 0;
  alreadyNotified = false;
  assigned = false;
  order = {
    id: 'o1', code: 'ORD-1', status: 'PREPARING', branchId: 'b1', fulfillmentType: 'DELIVERY', customerId: 'c1', subtotal: 100,
    customer: null, freebieRuleId: null, branch: { restaurantId: 'r1', restaurant: { parentId: null } },
  };
});

describe('transitionOrder dispatch telemetry', () => {
  it('passes the milestone + explicit source to the hook', async () => {
    await transitionOrder('o1', 'READY' as any, { actorId: 'k1', eventSource: 'KITCHEN' as any });
    expect(hookCalls[0]).toMatchObject({ orderId: 'o1', next: 'READY', source: 'KITCHEN', actorId: 'k1', fulfillmentType: 'DELIVERY' });
  });

  it('defaults the source to ADMIN with an actor and SYSTEM without', async () => {
    await transitionOrder('o1', 'READY' as any, { actorId: 'x' });
    order.status = 'PREPARING';
    await transitionOrder('o1', 'READY' as any);
    expect(hookCalls.map((h) => h.source)).toEqual(['ADMIN', 'SYSTEM']);
  });

  it('legacy READY flow is unchanged when JIT did nothing: pool + push + batch', async () => {
    await transitionOrder('o1', 'READY' as any);
    expect(published).toContain('rider:pool');
    expect(pushed).toEqual(['o1']);
    expect(batched).toEqual(['o1']);
  });

  it('does not re-push riders JIT already invited, but still offers batching', async () => {
    alreadyNotified = true;
    await transitionOrder('o1', 'READY' as any);
    expect(pushed).toEqual([]);
    expect(batched).toEqual(['o1']);
  });

  it('skips push and batch when a rider already holds the order', async () => {
    assigned = true;
    await transitionOrder('o1', 'READY' as any);
    expect(pushed).toEqual([]);
    expect(batched).toEqual([]);
    expect(published).toContain('rider:pool');
  });

  it('PICKUP orders never hit rider dispatch', async () => {
    order.fulfillmentType = 'PICKUP';
    await transitionOrder('o1', 'READY' as any);
    expect(pushed).toEqual([]);
    expect(published).not.toContain('rider:pool');
    expect(hookCalls).toHaveLength(1);
  });
});
