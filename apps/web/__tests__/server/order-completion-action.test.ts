import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn() } }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { completionAction, needsRider } from '@/lib/order-actions';
import { ALLOWED_NEXT } from '@/server/orders';
import { OrderStatus } from '@prisma/client';

describe('completionAction (pickup / dine-in hand-over)', () => {
  it('offers DELIVERED for READY pickup and dine-in orders', () => {
    expect(completionAction({ status: 'READY', fulfillmentType: 'PICKUP' })).toEqual({ next: 'DELIVERED', label: 'Mark collected' });
    expect(completionAction({ status: 'READY', fulfillmentType: 'DINE_IN' })?.next).toBe('DELIVERED');
  });
  it('offers nothing for delivery orders or non-READY orders', () => {
    expect(completionAction({ status: 'READY', fulfillmentType: 'DELIVERY' })).toBeNull();
    expect(completionAction({ status: 'READY', fulfillmentType: null })).toBeNull();
    expect(completionAction({ status: 'PREPARING', fulfillmentType: 'PICKUP' })).toBeNull();
  });
  it('the state machine allows the offered transition', () => {
    expect(ALLOWED_NEXT[OrderStatus.READY]).toContain(OrderStatus.DELIVERED);
  });
  it('only delivery orders need a rider', () => {
    expect(needsRider({ fulfillmentType: 'DELIVERY' })).toBe(true);
    expect(needsRider({ fulfillmentType: 'PICKUP' })).toBe(false);
    expect(needsRider({ fulfillmentType: 'DINE_IN' })).toBe(false);
  });
});

import { isCancelledStatus, CANCELLED_STATUSES } from '@/lib/order-actions';

describe('isCancelledStatus (Cancelled filter)', () => {
  it('matches legacy CANCELLED and every CANCELLED_BY_* status', () => {
    for (const s of ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN']) {
      expect(isCancelledStatus(s)).toBe(true);
    }
    expect(isCancelledStatus('DELIVERED')).toBe(false);
    expect(isCancelledStatus('REFUND_PENDING')).toBe(false);
  });
  it('covers every CANCELLED* value in the OrderStatus enum', () => {
    const enumCancels = Object.values(OrderStatus).filter((s) => s.startsWith('CANCELLED'));
    expect([...CANCELLED_STATUSES].sort()).toEqual(enumCancels.sort());
  });
});
