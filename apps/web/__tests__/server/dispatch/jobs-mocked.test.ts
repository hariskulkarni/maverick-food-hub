/**
 * Dispatch jobs with a mocked database (the real-SQL paths are covered by
 * telemetry-pg.int.test.ts when TELEMETRY_PG_URL is set): JIT sweep no-op when
 * off, single-winner release, plan-on-accept gating, food-ready marking, the
 * hook glue, stationary debounce and zone snapshot idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let jit: any;
const calls: Record<string, any[]> = {};
const rec = (k: string, v: any) => { (calls[k] ??= []).push(v); };
let planRow: any;
let updateManyCount = 1;
let orderRow: any;
let prediction: any;
let movement: any[] = [];
let debounceRow: any;
let openEsc: any;
let activeAssignments: any[] = [];

vi.mock('@/server/dispatch/settings', () => ({ getJitConfig: async () => jit }));
vi.mock('@/server/dispatch/prep', () => ({ predictPrepMinutes: async () => prediction }));
vi.mock('@/server/realtime', () => ({ publish: (ch: string, e: any) => rec('publish', { ch, e }) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: async (id: string) => rec('push', id) }));
vi.mock('@/server/db', () => ({
  prisma: {
    orderEvent: { createMany: async (a: any) => { rec('event', a.data[0]); return { count: 1 }; } },
    orderDispatchPlan: {
      findUnique: async () => planRow,
      findMany: async (a: any) => { rec('planFindMany', a); return []; },
      updateMany: async (a: any) => { rec('planUpdateMany', a); return { count: updateManyCount }; },
      create: async (a: any) => { rec('planCreate', a.data); return a.data; },
      update: async (a: any) => rec('planUpdate', a),
    },
    order: { findUnique: async () => orderRow, findMany: async () => [] },
    riderProfile: { findMany: async () => [] },
    riderAssignment: { findUnique: async () => null, findMany: async () => activeAssignments },
    alertDebounce: { findUnique: async () => debounceRow, upsert: async (a: any) => rec('debounce', a) },
    orderEscalation: { findFirst: async () => openEsc, create: async (a: any) => rec('escalation', a.data) },
    zoneSupplyDemand: { deleteMany: async (a: any) => { rec('zoneDelete', a); return { count: 0 }; }, createMany: async (a: any) => rec('zoneCreate', a) },
    $queryRaw: async () => movement,
    $transaction: async (ops: any[]) => Promise.all(ops),
  },
}));

import { runJitReleaseSweep, releaseOrderToDispatch, planDispatchOnAccept, onFoodReady } from '@/server/dispatch/jit';
import { onOrderTransition } from '@/server/dispatch/hooks';
import { runStationarySweep } from '@/server/dispatch/stationary';

const MIN = 60_000;
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  jit = { enabled: false, bufferMin: 3, roadFactor: 1.35, speedKph: 20, rangeKm: 5, promiseSlaMin: 45 };
  planRow = null;
  updateManyCount = 1;
  orderRow = { id: 'o1', status: 'PREPARING', branchId: 'b1', fulfillmentType: 'DELIVERY', assignment: null, scheduledFor: null, placedAt: new Date(), acceptedAt: new Date(), estimatedDeliveryAt: null, address: null, branch: { latitude: null, longitude: null, restaurant: { id: 'r1', riderDispatchMode: 'FLEET_ONLY' } } };
  prediction = { minutes: 18, source: 'quoted', samples: 0, quotedMin: 18, restaurantId: 'r1', acceptedAt: null };
  movement = [];
  debounceRow = null;
  openEsc = null;
  activeAssignments = [];
});

describe('JIT sweep + release', () => {
  it('is a no-op (no DB reads) while the setting is off', async () => {
    expect(await runJitReleaseSweep()).toEqual({ enabled: false, held: 0, released: 0, byReason: {} });
    expect(calls.planFindMany).toBeUndefined();
  });

  it('release is single-winner: a second release publishes nothing', async () => {
    expect(await releaseOrderToDispatch('o1', 'jit_due')).toBe(true);
    expect(calls.publish?.[0]).toMatchObject({ ch: 'rider:pool', e: { kind: 'order:new', orderId: 'o1' } });
    expect(calls.push).toEqual(['o1']);
    expect(calls.event[0]).toMatchObject({ type: 'INVITED', dedupeKey: 'INVITED:pool' });
    updateManyCount = 0;
    for (const k of Object.keys(calls)) delete calls[k];
    expect(await releaseOrderToDispatch('o1', 'jit_due')).toBe(false);
    expect(calls.publish).toBeUndefined();
  });

  it('does not publish a released order a rider already holds or that is READY', async () => {
    orderRow.assignment = { id: 'a1' };
    await releaseOrderToDispatch('o1', 'jit_due');
    orderRow.assignment = null;
    orderRow.status = 'READY';
    await releaseOrderToDispatch('o1', 'jit_due');
    expect(calls.publish).toBeUndefined();
  });
});

describe('plan on accept', () => {
  it('JIT off: stores the prediction only, never releases', async () => {
    await planDispatchOnAccept('o1');
    expect(calls.planCreate[0]).toMatchObject({ orderId: 'o1', predictedPrepMin: 18, prepSource: 'quoted', jit: false, releaseAt: null });
    expect(calls.planUpdateMany).toBeUndefined();
  });
  it('JIT on with no rider fix → releases at once (no_rider_in_range)', async () => {
    jit.enabled = true;
    await planDispatchOnAccept('o1');
    expect(calls.planCreate[0].jit).toBe(true);
    expect(calls.planUpdateMany[0].data.releaseReason).toBe('no_rider_in_range');
  });
  it('skips PICKUP orders, scheduled orders keep the READY flow, existing plans are kept', async () => {
    orderRow.fulfillmentType = 'PICKUP';
    await planDispatchOnAccept('o1');
    expect(calls.planCreate).toBeUndefined();
    orderRow.fulfillmentType = 'DELIVERY';
    orderRow.scheduledFor = new Date(Date.now() + 3 * 3600_000);
    jit.enabled = true;
    await planDispatchOnAccept('o1');
    expect(calls.planCreate[0].jit).toBe(false);
    planRow = { orderId: 'o1' };
    delete calls.planCreate;
    await planDispatchOnAccept('o1');
    expect(calls.planCreate).toBeUndefined();
  });
});

describe('food ready', () => {
  it('marks an unreleased plan released (food_ready) and reports not-yet-notified', async () => {
    planRow = { releasedAt: null };
    expect(await onFoodReady('o1')).toEqual({ alreadyNotified: false });
    expect(calls.planUpdateMany[0].data.releaseReason).toBe('food_ready');
    expect(calls.event[0]).toMatchObject({ type: 'INVITED', dedupeKey: 'INVITED:pool' });
  });
  it('reports already-notified when JIT released earlier', async () => {
    planRow = { releasedAt: new Date() };
    expect(await onFoodReady('o1')).toEqual({ alreadyNotified: true });
    expect(calls.planUpdateMany).toBeUndefined();
  });
});

describe('hook glue', () => {
  it('records the milestone and plans only on ACCEPTED delivery orders', async () => {
    await onOrderTransition({ orderId: 'o1', next: 'ACCEPTED' as any, fulfillmentType: 'DELIVERY' as any, source: 'KITCHEN' as any, actorId: 'k1', note: null });
    expect(calls.event[0]).toMatchObject({ type: 'ACCEPTED', source: 'KITCHEN', actorId: 'k1', dedupeKey: 'ACCEPTED' });
    expect(calls.planCreate).toHaveLength(1);
    await onOrderTransition({ orderId: 'o1', next: 'ACCEPTED' as any, fulfillmentType: 'PICKUP' as any, source: 'SYSTEM' as any, actorId: null, note: null });
    await onOrderTransition({ orderId: 'o1', next: 'REFUNDED' as any, fulfillmentType: 'DELIVERY' as any, source: 'SYSTEM' as any, actorId: null, note: null });
    expect(calls.planCreate).toHaveLength(1);
    expect(calls.event).toHaveLength(2);
  });
});

describe('stationary sweep', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  const cfg = { windowMin: 8, moveM: 50, geofenceM: 150, debounceMin: 30, maxFixAgeMin: 3 };
  beforeEach(() => {
    activeAssignments = [{ id: 'a1', riderId: 'rp1', status: 'PICKED_UP', order: { id: 'o1', code: 'ORD-1', branch: { latitude: 12.97, longitude: 77.59 }, address: null } }];
    movement = [{ riderId: 'rp1', a_lat: 12.99, a_lng: 77.6, a_at: new Date(now.getTime() - 10 * MIN), l_lat: 12.99, l_lng: 77.6, l_at: new Date(now.getTime() - 20_000), max_move_m: 5 }];
  });
  it('opens one escalation and stamps the debounce', async () => {
    const r = await runStationarySweep(now, cfg);
    expect(r).toEqual({ checked: 1, alerted: 1, debounced: 0 });
    expect(calls.escalation[0]).toMatchObject({ orderId: 'o1', type: 'RIDER_STATIONARY', severity: 'MEDIUM' });
    expect(calls.escalation[0].message).toMatch(/heading to customer/);
    expect(calls.debounce).toHaveLength(1);
  });
  it('respects the per-assignment debounce window and an existing OPEN escalation', async () => {
    debounceRow = { lastSentAt: new Date(now.getTime() - 10 * MIN) };
    expect((await runStationarySweep(now, cfg)).debounced).toBe(1);
    debounceRow = { lastSentAt: new Date(now.getTime() - 40 * MIN) };
    openEsc = { id: 'e1' };
    expect((await runStationarySweep(now, cfg)).alerted).toBe(0);
    expect(calls.escalation).toBeUndefined();
  });
  it('a moving rider raises nothing', async () => {
    movement[0].max_move_m = 400;
    expect((await runStationarySweep(now, cfg)).alerted).toBe(0);
  });
});
