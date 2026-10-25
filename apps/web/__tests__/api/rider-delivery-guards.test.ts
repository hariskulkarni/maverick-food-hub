/**
 * P1-7 accept/pickup state guards, P2-21 fail before/after pickup, P0-1
 * idempotent deliver + P1-5 attempt cap (route logic; the money effects are
 * proven against real Postgres in tests/db/rider-flow.db.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  session: { user: { id: 'u1', role: 'RIDER' } } as any,
  assignment: null as any,
  updateManyCount: 1,
  updates: [] as any[],
  transitions: [] as any[],
  transitionThrows: null as null | Error,
  released: true,
  attemptsAfter: 1
}));

vi.mock('@/server/rider-auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/orders', () => {
  class OrderTransitionError extends Error {}
  return {
    OrderTransitionError,
    transitionOrder: async (orderId: string, next: string, opts: any) => {
      m.transitions.push({ orderId, next, opts });
      if (m.transitionThrows) throw m.transitionThrows;
      return {};
    }
  };
});
vi.mock('@/server/rider-assignment-release', () => ({ releaseAssignmentBeforePickup: async () => m.released }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/realtime', () => ({ publish: () => {} }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: async () => {} }));
vi.mock('@/server/rider-payments', () => ({ applyIncentivesForDelivery: async () => [] }));
vi.mock('@/server/dispatch/events', () => ({ recordOrderEvent: async () => true }));
vi.mock('@/server/dispatch/jit', () => ({ PRE_READY_STATUSES: ['ACCEPTED', 'PREPARING'], isReleasedForDispatch: async () => false }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async ({ where }: any) => (where.userId === 'u1' ? { id: 'rp1' } : { id: 'other' }) },
    riderAssignment: {
      findUnique: async ({ select }: any) => (select?.deliveryOtpAttempts ? { deliveryOtpAttempts: m.attemptsAfter } : m.assignment),
      updateMany: async (args: any) => {
        m.updates.push(args);
        return { count: m.updateManyCount };
      },
      update: async ({ data }: any) => ({ ...m.assignment, ...data })
    },
    order: { update: async () => ({}) },
    $transaction: async (fn: any) => fn({})
  }
}));

import { POST as accept } from '@/app/api/rider/assignments/[id]/accept/route';
import { POST as pickup } from '@/app/api/rider/assignments/[id]/pickup/route';
import { POST as fail } from '@/app/api/rider/assignments/[id]/fail/route';
import { POST as deliver } from '@/app/api/rider/assignments/[id]/deliver/route';
import { OrderTransitionError } from '@/server/orders';

const p = { params: Promise.resolve({ id: 'a1' }) };
const body = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }) as any;

beforeEach(() => {
  m.session = { user: { id: 'u1', role: 'RIDER' } };
  m.updateManyCount = 1;
  m.updates = [];
  m.transitions = [];
  m.transitionThrows = null;
  m.released = true;
  m.attemptsAfter = 1;
});

describe('accept (P1-7)', () => {
  it('only PENDING → ACCEPTED; a cancelled assignment is never revived', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', status: 'CANCELLED' };
    m.updateManyCount = 0;
    const r = await accept({} as any, p);
    expect(r.status).toBe(409);
    expect(m.updates[0].where).toMatchObject({ id: 'a1', status: 'PENDING' });
  });
  it("404s for another rider's assignment", async () => {
    m.assignment = { id: 'a1', riderId: 'someone', status: 'PENDING' };
    expect((await accept({} as any, p)).status).toBe(404);
  });
});

describe('pickup (P1-7)', () => {
  it('refuses while the kitchen is still preparing — no OUT_FOR_DELIVERY, no OTP SMS', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', status: 'ACCEPTED', order: { id: 'o1', status: 'PREPARING' } };
    const r = await pickup({} as any, p);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/hasn't marked this order ready/);
    expect(m.transitions).toHaveLength(0);
    expect(m.updates).toHaveLength(0);
  });
  it('READY order: moves the order out for delivery, then flips ACCEPTED → PICKED_UP conditionally', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', status: 'ACCEPTED', order: { id: 'o1', status: 'READY' } };
    expect((await pickup({} as any, p)).status).toBe(200);
    expect(m.transitions[0]).toMatchObject({ orderId: 'o1', next: 'OUT_FOR_DELIVERY' });
    expect(m.updates[0].where).toEqual({ id: 'a1', status: 'ACCEPTED' });
  });
  it('a cancelled/closed assignment cannot be picked up', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', status: 'CANCELLED', order: { id: 'o1', status: 'READY' } };
    expect((await pickup({} as any, p)).status).toBe(409);
  });
});

describe('fail (P2-21)', () => {
  const order = (status: string) => ({ id: 'o1', status, branchId: 'b1', payments: [], cancellationReason: null, cancelReason: null });
  it('before pickup: hands the order back to the pool instead of failing it', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', orderId: 'o1', status: 'ACCEPTED', order: order('READY') };
    const r = await fail(body({ reason: 'RIDER_VEHICLE_ISSUE' }), p);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, outcome: 'released' });
    expect(m.transitions).toHaveLength(0);
  });
  it('after pickup: marks the order DELIVERY_FAILED', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', orderId: 'o1', status: 'PICKED_UP', order: order('OUT_FOR_DELIVERY') };
    const r = await fail(body({ reason: 'CUSTOMER_UNREACHABLE', note: 'no answer x3' }), p);
    expect(await r.json()).toEqual({ ok: true, outcome: 'failed' });
    expect(m.transitions[0]).toMatchObject({ next: 'DELIVERY_FAILED' });
  });
  it('maps an impossible transition to 409 (was a 500) and requires a note for OTHER', async () => {
    m.assignment = { id: 'a1', riderId: 'rp1', orderId: 'o1', status: 'PICKED_UP', order: order('DELIVERED') };
    m.transitionThrows = new OrderTransitionError('nope');
    expect((await fail(body({ reason: 'CUSTOMER_WRONG_ADDRESS' }), p)).status).toBe(409);
    expect((await fail(body({ reason: 'OTHER' }), p)).status).toBe(400);
  });
});

describe('deliver (P0-1 / P1-5)', () => {
  const a = (over: any = {}) => ({
    id: 'a1', riderId: 'rp1', orderId: 'o1', status: 'PICKED_UP', deliveryOtpAttempts: 0,
    order: { id: 'o1', status: 'OUT_FOR_DELIVERY', deliveryOtp: '4821' }, ...over
  });
  it('a repeat POST after success is an idempotent 200 that pays nothing', async () => {
    m.assignment = a({ status: 'DELIVERED' });
    const r = await deliver(body({ otp: '4821' }), p);
    expect(r.status).toBe(200);
    expect((await r.json()).alreadyDelivered).toBe(true);
    expect(m.transitions).toHaveLength(0);
  });
  it('refuses a cancelled assignment or an order not yet out for delivery', async () => {
    m.assignment = a({ status: 'CANCELLED' });
    expect((await deliver(body({ otp: '4821' }), p)).status).toBe(409);
    m.assignment = a({ order: { id: 'o1', status: 'READY', deliveryOtp: '4821' } });
    expect((await deliver(body({ otp: '4821' }), p)).status).toBe(409);
    expect(m.transitions).toHaveLength(0);
  });
  it('counts wrong codes and locks at 5', async () => {
    m.assignment = a();
    m.attemptsAfter = 2;
    const r = await deliver(body({ otp: '1111' }), p);
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/3 tries left/);
    m.attemptsAfter = 5;
    const locked = await deliver(body({ otp: '1111' }), p);
    expect(locked.status).toBe(429);
    expect(m.transitions[0]).toMatchObject({ next: 'DELIVERY_OTP_FAILED' });
    m.assignment = a({ deliveryOtpAttempts: 5 });
    expect((await deliver(body({ otp: '4821' }), p)).status).toBe(429);
  });
  it('the right code delivers through transitionOrder (single source of truth) and skips its incentive call', async () => {
    m.assignment = a();
    expect((await deliver(body({ otp: '48 21' }), p)).status).toBe(200);
    expect(m.transitions[0]).toMatchObject({ next: 'DELIVERED', opts: { skipRiderIncentives: true } });
  });
});
