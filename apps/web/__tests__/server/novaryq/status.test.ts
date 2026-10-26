/**
 * CONTRACT §3 status table: Novaryq POS status → Flavrly transitions, applied only
 * through transitionOrder, with the stale/out-of-order guard and the
 * never-auto-cancel-after-pickup rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sync: null as any,
  guardCount: 1,
  transitions: [] as Array<[string, string, any]>,
  escalations: [] as any[],
  alerts: [] as any[],
  orderStatus: 'RECEIVED',
  failOn: null as string | null,
}));

vi.mock('@/server/db', () => {
  const prisma = {
    novaryqOrderSync: {
      findFirst: vi.fn(async ({ where }: any) => (h.sync && where.orderId === h.sync.orderId && where.restaurantId === h.sync.restaurantId ? { ...h.sync, order: { id: h.sync.orderId, code: 'ORD-1', status: h.orderStatus, fulfillmentType: h.sync.fulfillmentType ?? 'DELIVERY' } } : null)),
      updateMany: vi.fn(async () => ({ count: h.guardCount })),
    },
    orderEscalation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => { h.escalations.push(data); return data; }),
    },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/orders', () => ({
  transitionOrder: vi.fn(async (id: string, next: string, opts: any) => {
    if (h.failOn === next) throw new Error('boom');
    h.transitions.push([id, next, opts]);
    h.orderStatus = next;
  }),
}));
vi.mock('@/server/novaryq/alerts', () => ({ sendNovaryqAlert: vi.fn(async (a: any) => { h.alerts.push(a); }) }));

import { planStatusAction, applyOrderStatusEvent } from '@/server/novaryq/status';

beforeEach(() => {
  h.sync = { id: 's1', orderId: 'o1', restaurantId: 'r1', novaryqOrderId: 'nq1', lastStatusAt: null };
  h.guardCount = 1;
  h.transitions = [];
  h.escalations = [];
  h.alerts = [];
  h.orderStatus = 'RECEIVED';
  h.failOn = null;
});

describe('planStatusAction (§3 table)', () => {
  const steps = (nq: string, cur: string, ft = 'DELIVERY') => {
    const a = planStatusAction(nq, cur as any, ft as any);
    return a.kind === 'transition' ? a.steps : a.kind;
  };

  it('OPEN → nothing', () => expect(steps('OPEN', 'RECEIVED')).toBe('none'));
  it('SENT → ACCEPTED only from RECEIVED', () => {
    expect(steps('SENT', 'RECEIVED')).toEqual(['ACCEPTED']);
    expect(steps('SENT', 'PREPARING')).toBe('none');
  });
  it('IN_PREP → PREPARING via ACCEPTED when needed', () => {
    expect(steps('IN_PREP', 'RECEIVED')).toEqual(['ACCEPTED', 'PREPARING']);
    expect(steps('IN_PREP', 'ACCEPTED')).toEqual(['PREPARING']);
    expect(steps('IN_PREP', 'READY')).toBe('none');
  });
  it('READY → READY via ACCEPTED/PREPARING when needed', () => {
    expect(steps('READY', 'RECEIVED')).toEqual(['ACCEPTED', 'PREPARING', 'READY']);
    expect(steps('READY', 'PREPARING')).toEqual(['READY']);
    expect(steps('READY', 'OUT_FOR_DELIVERY')).toBe('none');
  });
  it('COMPLETED → nothing for DELIVERY; DELIVERED for TAKEOUT/DINE_IN when READY', () => {
    expect(steps('COMPLETED', 'READY', 'DELIVERY')).toBe('none');
    expect(steps('COMPLETED', 'READY', 'PICKUP')).toEqual(['DELIVERED']);
    expect(steps('COMPLETED', 'READY', 'DINE_IN')).toEqual(['DELIVERED']);
    expect(steps('COMPLETED', 'PREPARING', 'PICKUP')).toBe('none');
  });
  it('VOIDED → CANCELLED_BY_RESTAURANT before pickup', () => {
    for (const s of ['RECEIVED', 'ACCEPTED', 'PREPARING']) expect(steps('VOIDED', s)).toEqual(['CANCELLED_BY_RESTAURANT']);
  });
  it('VOIDED after pickup (or past the restaurant-cancel point) → ops exception, never a cancel', () => {
    for (const s of ['READY', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      expect(steps('VOIDED', s)).toBe('exception');
    }
    expect(steps('VOIDED', 'CANCELLED_BY_CUSTOMER')).toBe('none');
  });
  it('REFUNDED and unknown statuses → nothing', () => {
    expect(steps('REFUNDED', 'DELIVERED')).toBe('none');
    expect(steps('WHATEVER', 'RECEIVED')).toBe('none');
  });
});

describe('applyOrderStatusEvent', () => {
  const ev = (status: string, occurredAt = '2026-10-25T10:00:00Z', extra: any = {}) => ({
    restaurantId: 'r1', externalRef: 'o1', orderId: 'nq1', status, occurredAt, ...extra,
  });

  it('walks the path through transitionOrder (tenant-scoped), never a direct write', async () => {
    const r = await applyOrderStatusEvent(ev('READY'));
    expect(r).toBe('applied');
    expect(h.transitions.map((t) => t[1])).toEqual(['ACCEPTED', 'PREPARING', 'READY']);
    expect(h.transitions[0][0]).toBe('o1');
    expect(h.transitions[0][2]).toMatchObject({ scopeRestaurantId: 'r1' });
  });

  it('a stale/out-of-order event (older occurredAt than the last applied) is ignored', async () => {
    h.guardCount = 0; // conditional lastStatusAt <= occurredAt update matched nothing
    const r = await applyOrderStatusEvent(ev('IN_PREP', '2026-10-25T09:00:00Z'));
    expect(r).toBe('ignored:stale');
    expect(h.transitions).toEqual([]);
  });

  it('an event for an order this restaurant never pushed is ignored (tenant scope)', async () => {
    expect(await applyOrderStatusEvent({ ...ev('READY'), restaurantId: 'r2' })).toBe('ignored:unknown_order');
    expect(h.transitions).toEqual([]);
  });

  it('a Novaryq order id that contradicts the pushed one is ignored', async () => {
    expect(await applyOrderStatusEvent(ev('READY', undefined, { orderId: 'nq-other' }))).toBe('ignored:order_mismatch');
  });

  it('VOIDED after pickup raises a POS_VOIDED escalation + alert and does not cancel', async () => {
    h.orderStatus = 'OUT_FOR_DELIVERY';
    const r = await applyOrderStatusEvent(ev('VOIDED'));
    expect(r).toBe('exception');
    expect(h.transitions).toEqual([]);
    expect(h.escalations[0]).toMatchObject({ orderId: 'o1', type: 'POS_VOIDED' });
    expect(h.alerts.length).toBe(1);
  });

  it('VOIDED before pickup cancels as the restaurant', async () => {
    h.orderStatus = 'PREPARING';
    await applyOrderStatusEvent(ev('VOIDED'));
    expect(h.transitions.map((t) => t[1])).toEqual(['CANCELLED_BY_RESTAURANT']);
  });

  it('a failed transition propagates so the worker retries the event', async () => {
    h.failOn = 'PREPARING';
    await expect(applyOrderStatusEvent(ev('IN_PREP'))).rejects.toThrow('boom');
  });
});
