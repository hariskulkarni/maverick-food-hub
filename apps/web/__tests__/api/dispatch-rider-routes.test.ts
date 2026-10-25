/**
 * Rider routes touched by dispatch telemetry: pool (JIT-released pre-ready
 * orders), claim (released vs not), pickup (implied food-ready walk), and the
 * arrival taps writing OrderEvents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any;
let profile: any;
let order: any;
let assignment: any;
let released: boolean;
let jitIds: string[];
let poolCandidates: any[];
let lastPoolWhere: any;
const events: any[] = [];
const transitions: any[] = [];
let created: any[] = [];

vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/payouts', () => ({ computeBasePayout: async () => ({ payout: 50, baseAmount: 40, distanceKm: 2 }) }));
vi.mock('@/server/rider-sourcing', () => ({
  resolveDedicatedGroup: async (p: any) => p,
  riderCanClaimOrder: () => true,
  filterOrdersForRider: (_p: any, list: any[]) => list,
}));
vi.mock('@/server/dispatch/events', () => ({ recordOrderEvent: async (e: any) => { events.push(e); return true; } }));
vi.mock('@/server/dispatch/jit', () => ({
  PRE_READY_STATUSES: ['ACCEPTED', 'PREPARING'],
  isReleasedForDispatch: async () => released,
  releasedPreReadyOrderIds: async () => jitIds,
}));
vi.mock('@/server/orders', () => ({
  transitionOrder: async (id: string, next: string, opts: any) => { transitions.push({ id, next, opts }); if (order) order.status = next; return {}; },
}));
vi.mock('@/server/db', () => {
  const tx = {
    riderAssignment: { create: async ({ data }: any) => { created.push(data); return { id: 'a-new', ...data }; } },
    riderProfile: { update: async () => ({}) },
  };
  return {
    prisma: {
      riderProfile: { findUnique: async () => profile },
      order: {
        findUnique: async () => order,
        findMany: async ({ where }: any) => { lastPoolWhere = where; return poolCandidates; },
      },
      riderAssignment: {
        findUnique: async () => assignment,
        update: async ({ data }: any) => ({ ...assignment, ...data }),
      },
      $transaction: async (fn: any) => fn(tx),
    },
  };
});

import { GET as pool } from '@/app/api/rider/pool/route';
import { POST as claim } from '@/app/api/rider/pool/[orderId]/claim/route';
import { POST as pickup } from '@/app/api/rider/assignments/[id]/pickup/route';
import { POST as reachRestaurant } from '@/app/api/rider/assignments/[id]/reach-restaurant/route';
import { POST as reachCustomer } from '@/app/api/rider/assignments/[id]/reach-customer/route';

const p = (k: string, v: string) => ({ params: Promise.resolve({ [k]: v }) }) as any;
const poolOrder = (id: string, status: string) => ({
  id, code: id, status, readyAt: status === 'READY' ? new Date() : null, total: 100, items: [], address: null, customer: {},
  branch: { name: 'B', line1: 'l', city: 'c', latitude: 1, longitude: 2, restaurant: { id: 'r1', name: 'R' } },
});

beforeEach(() => {
  session = { user: { id: 'u1', role: 'RIDER' } };
  profile = { id: 'rp1', approvedAt: new Date(), isOnline: true, riderType: 'FLEET', dedicatedRestaurantId: null, currentLat: 12.9, currentLng: 77.6 };
  order = { id: 'o1', status: 'READY', fulfillmentType: 'DELIVERY', assignment: null, branch: { restaurant: { id: 'r1' } } };
  assignment = { id: 'a1', riderId: 'rp1', orderId: 'o1', notes: null };
  released = false;
  jitIds = [];
  poolCandidates = [];
  lastPoolWhere = null;
  events.length = 0;
  transitions.length = 0;
  created = [];
});

describe('GET /api/rider/pool', () => {
  it('only READY orders when JIT released nothing', async () => {
    await pool({} as any);
    expect(lastPoolWhere).toEqual({ assignment: null, OR: [{ status: 'READY' }] });
  });
  it('adds JIT-released pre-ready delivery orders, flagged foodReady:false', async () => {
    jitIds = ['o2'];
    poolCandidates = [poolOrder('o1', 'READY'), poolOrder('o2', 'PREPARING')];
    const body = await (await pool({} as any)).json();
    expect(lastPoolWhere.OR[1]).toEqual({ id: { in: ['o2'] }, status: { in: ['ACCEPTED', 'PREPARING'] }, fulfillmentType: 'DELIVERY' });
    expect(body.map((o: any) => [o.orderId, o.foodReady])).toEqual([['o1', true], ['o2', false]]);
  });
});

describe('POST /api/rider/pool/[orderId]/claim', () => {
  it('claims a READY order and records ASSIGNED (rider source, fix)', async () => {
    const r = await claim({} as any, p('orderId', 'o1'));
    expect(r.status).toBe(200);
    expect(created).toHaveLength(1);
    expect(events[0]).toMatchObject({ orderId: 'o1', type: 'ASSIGNED', source: 'RIDER', riderId: 'rp1', lat: 12.9, lng: 77.6, meta: { via: 'pool', preReady: false } });
  });
  it('rejects a pre-ready order JIT has not released', async () => {
    order.status = 'PREPARING';
    expect((await claim({} as any, p('orderId', 'o1'))).status).toBe(400);
    expect(created).toHaveLength(0);
  });
  it('accepts a JIT-released pre-ready delivery order', async () => {
    order.status = 'PREPARING';
    released = true;
    expect((await claim({} as any, p('orderId', 'o1'))).status).toBe(200);
    expect(events[0].meta.preReady).toBe(true);
  });
  it('never claims pre-ready PICKUP orders even if a plan says released', async () => {
    order.status = 'PREPARING';
    order.fulfillmentType = 'PICKUP';
    released = true;
    expect((await claim({} as any, p('orderId', 'o1'))).status).toBe(400);
  });
});

describe('POST /api/rider/assignments/[id]/pickup', () => {
  it('READY → OUT_FOR_DELIVERY and records PICKED_UP', async () => {
    await pickup({} as any, p('id', 'a1'));
    expect(transitions.map((t) => t.next)).toEqual(['OUT_FOR_DELIVERY']);
    expect(transitions[0].opts.eventSource).toBe('RIDER');
    expect(events[0]).toMatchObject({ type: 'PICKED_UP', source: 'RIDER', riderId: 'rp1' });
  });
  it('a JIT rider picking up before the kitchen tap implies food ready', async () => {
    order.status = 'PREPARING';
    await pickup({} as any, p('id', 'a1'));
    expect(transitions.map((t) => t.next)).toEqual(['READY', 'OUT_FOR_DELIVERY']);
    expect(transitions[0].opts).toMatchObject({ eventSource: 'RIDER', note: 'Food ready implied by rider pickup' });
  });
  it('walks ACCEPTED through PREPARING and READY', async () => {
    order.status = 'ACCEPTED';
    await pickup({} as any, p('id', 'a1'));
    expect(transitions.map((t) => t.next)).toEqual(['PREPARING', 'READY', 'OUT_FOR_DELIVERY']);
  });
  it("404s for another rider's assignment", async () => {
    assignment.riderId = 'other';
    expect((await pickup({} as any, p('id', 'a1'))).status).toBe(404);
    expect(events).toHaveLength(0);
  });
});

describe('arrival taps', () => {
  it('reach-restaurant records ARRIVED_RESTAURANT even when the status move is not allowed', async () => {
    const r = await reachRestaurant({} as any, p('id', 'a1'));
    expect(r.status).toBe(200);
    expect(events[0]).toMatchObject({ orderId: 'o1', type: 'ARRIVED_RESTAURANT', source: 'RIDER', lat: 12.9 });
    expect(transitions[0].opts.eventSource).toBe('RIDER');
  });
  it('reach-customer records ARRIVED_CUSTOMER', async () => {
    await reachCustomer({} as any, p('id', 'a1'));
    expect(events[0]).toMatchObject({ type: 'ARRIVED_CUSTOMER', source: 'RIDER' });
  });
});
