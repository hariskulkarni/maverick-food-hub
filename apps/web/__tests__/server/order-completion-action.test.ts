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
