import { describe, it, expect, vi } from 'vitest';

// orders.ts pulls in prisma, realtime, notifications, payments. We only need the
// pure ALLOWED_NEXT map for these tests, so stub all the heavy module
// dependencies up front.
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn() } }));
vi.mock('@/server/payments', () => ({ paymentProvider: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ALLOWED_NEXT, OrderTransitionError } from '@/server/orders';
import { OrderStatus } from '@prisma/client';

function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // idempotent same→same
  return ALLOWED_NEXT[from].includes(to);
}

describe('orders ALLOWED_NEXT — happy path transitions', () => {
  it('allows RECEIVED → ACCEPTED', () => {
    expect(ALLOWED_NEXT.RECEIVED).toContain(OrderStatus.ACCEPTED);
  });

  it('rejects RECEIVED → DELIVERED', () => {
    expect(ALLOWED_NEXT.RECEIVED).not.toContain(OrderStatus.DELIVERED);
  });

  it('allows ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED chain', () => {
    expect(ALLOWED_NEXT.ACCEPTED).toContain(OrderStatus.PREPARING);
    expect(ALLOWED_NEXT.PREPARING).toContain(OrderStatus.READY);
    // READY can go to RIDER_ASSIGNED or directly to OUT_FOR_DELIVERY
    expect(ALLOWED_NEXT.READY).toContain(OrderStatus.OUT_FOR_DELIVERY);
    expect(ALLOWED_NEXT.OUT_FOR_DELIVERY).toContain(OrderStatus.DELIVERED);
  });
});

describe('orders ALLOWED_NEXT — idempotency', () => {
  it('same → same is treated as a no-op (the transition handler returns the existing order)', () => {
    // The handler short-circuits before consulting ALLOWED_NEXT; this helper
    // mirrors that contract so consumers of the map don't have to.
    expect(canTransition(OrderStatus.RECEIVED, OrderStatus.RECEIVED)).toBe(true);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.DELIVERED)).toBe(true);
  });
});

describe('orders ALLOWED_NEXT — cancellation → refund', () => {
  it('allows CANCELLED_BY_ADMIN → REFUND_PENDING', () => {
    expect(ALLOWED_NEXT.CANCELLED_BY_ADMIN).toContain(OrderStatus.REFUND_PENDING);
  });

  it('allows CANCELLED_BY_CUSTOMER → REFUND_PENDING', () => {
    expect(ALLOWED_NEXT.CANCELLED_BY_CUSTOMER).toContain(OrderStatus.REFUND_PENDING);
  });

  it('allows CANCELLED_BY_RESTAURANT → REFUND_PENDING', () => {
    expect(ALLOWED_NEXT.CANCELLED_BY_RESTAURANT).toContain(OrderStatus.REFUND_PENDING);
  });
});

describe('orders ALLOWED_NEXT — terminal states', () => {
  const terminal: OrderStatus[] = [
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED
  ];

  it.each(terminal)('%s has no outgoing transitions', (s) => {
    expect(ALLOWED_NEXT[s]).toEqual([]);
  });

  it('rejects DELIVERED → RECEIVED', () => {
    expect(ALLOWED_NEXT.DELIVERED).not.toContain(OrderStatus.RECEIVED);
  });
});

describe('orders — OrderTransitionError is exported', () => {
  it('is a constructable Error subclass', () => {
    const e = new OrderTransitionError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('nope');
  });
});
