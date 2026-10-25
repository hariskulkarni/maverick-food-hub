/**
 * Dispatch telemetry against a REAL Postgres (the raw SQL: percentile_cont,
 * GROUPING SETS, DISTINCT ON, FILTER). Skipped unless TELEMETRY_PG_URL points
 * at a throwaway database with the full schema (`prisma db push`), e.g.
 *   TELEMETRY_PG_URL=postgresql://ci@localhost:55432/flavrly_telemetry_full?schema=public npx vitest run __tests__/server/dispatch
 * The suite wipes and re-seeds its own rows on every run.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const URL = process.env.TELEMETRY_PG_URL;
if (URL) process.env.DATABASE_URL = URL;

vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined), sendBatchInvitationPush: vi.fn() }));
const jitCfg = { enabled: true, bufferMin: 3, roadFactor: 1.35, speedKph: 20, rangeKm: 5, promiseSlaMin: 45 };
vi.mock('@/server/dispatch/settings', () => ({ getJitConfig: async () => jitCfg }));

const MIN = 60_000;

describe.skipIf(!URL)('dispatch telemetry on Postgres', () => {
  let prisma: any;
  const ids = { owner: '', cust: '', rest: '', branch: '', rider: '', riderUser: '', cat: '', item: '' };
  const NOW = new Date('2026-10-20T08:00:00Z'); // 13:30 IST

  async function wipe() {
    await prisma.orderEvent.deleteMany({});
    await prisma.orderDispatchPlan.deleteMany({});
    await prisma.restaurantPrepStat.deleteMany({});
    await prisma.zoneSupplyDemand.deleteMany({});
    await prisma.alertDebounce.deleteMany({ where: { kind: 'stationary' } });
    await prisma.orderEscalation.deleteMany({});
    await prisma.batchInvitation.deleteMany({});
    await prisma.deliveryLocationPing.deleteMany({});
    await prisma.riderArrival.deleteMany({});
    await prisma.riderAssignment.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.orderStatusEvent.deleteMany({});
    await prisma.order.deleteMany({ where: { code: { startsWith: 'TLM-' } } });
    await prisma.riderProfile.deleteMany({ where: { user: { phone: { startsWith: '+9100000' } } } });
    await prisma.menuItem.deleteMany({ where: { slug: 'tlm-item' } });
    await prisma.category.deleteMany({ where: { slug: 'tlm-cat' } });
    await prisma.branch.deleteMany({ where: { slug: 'tlm-branch' } });
    await prisma.restaurant.deleteMany({ where: { slug: 'tlm-rest' } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: '+9100000' } } });
  }

  beforeAll(async () => {
    ({ prisma } = await import('@/server/db'));
    await wipe();
    const owner = await prisma.user.create({ data: { role: 'ADMIN', phone: '+910000001', name: 'Owner' } });
    const cust = await prisma.user.create({ data: { role: 'CUSTOMER', phone: '+910000002', name: 'Cust' } });
    const riderUser = await prisma.user.create({ data: { role: 'RIDER', phone: '+910000003', name: 'Rider' } });
    const rest = await prisma.restaurant.create({ data: { slug: 'tlm-rest', name: 'Telemetry Kitchen', ownerUserId: owner.id, status: 'ACTIVE' } });
    const branch = await prisma.branch.create({ data: { restaurantId: rest.id, name: 'Main', slug: 'tlm-branch', line1: 'x', city: 'Bengaluru', postalCode: '560001', latitude: 12.9716, longitude: 77.5946 } });
    const cat = await prisma.category.create({ data: { branchId: branch.id, name: 'C', slug: 'tlm-cat' } });
    const item = await prisma.menuItem.create({ data: { branchId: branch.id, categoryId: cat.id, name: 'Biryani', slug: 'tlm-item', price: 200, prepTimeMin: 25 } });
    const rider = await prisma.riderProfile.create({ data: { userId: riderUser.id, isOnline: true, approvedAt: NOW, currentLat: 12.98, currentLng: 77.6 } });
    Object.assign(ids, { owner: owner.id, cust: cust.id, rest: rest.id, branch: branch.id, rider: rider.id, riderUser: riderUser.id, cat: cat.id, item: item.id });
  });

  afterAll(async () => {
    if (prisma) { await wipe(); await prisma.$disconnect(); }
  });

  async function order(code: string, o: Record<string, unknown>) {
    return prisma.order.create({
      data: { code, branchId: ids.branch, customerId: ids.cust, subtotal: 200, total: 200, paymentMethod: 'COD', items: { create: [{ menuItemId: ids.item, name: 'Biryani', quantity: 1, unitPrice: 200 }] }, ...o },
    });
  }

  it('records events once per milestone (ON CONFLICT DO NOTHING) but keeps repeatable ones', async () => {
    const { recordOrderEvent } = await import('@/server/dispatch/events');
    const o = await order('TLM-EV1', { status: 'READY', placedAt: NOW });
    expect(await recordOrderEvent({ orderId: o.id, type: 'FOOD_READY', source: 'KITCHEN' })).toBe(true);
    expect(await recordOrderEvent({ orderId: o.id, type: 'FOOD_READY', source: 'KITCHEN' })).toBe(false);
    await recordOrderEvent({ orderId: o.id, type: 'ASSIGNED', source: 'ADMIN' });
    await recordOrderEvent({ orderId: o.id, type: 'ASSIGNED', source: 'ADMIN' });
    expect(await prisma.orderEvent.count({ where: { orderId: o.id, type: 'FOOD_READY' } })).toBe(1);
    expect(await prisma.orderEvent.count({ where: { orderId: o.id, type: 'ASSIGNED' } })).toBe(2);
  });

  it('computes prep percentiles (hour bucket + all-hours) and predicts from them after 30 samples', async () => {
    const { computePrepStats, predictPrepMinutes } = await import('@/server/dispatch/prep');
    // 35 orders accepted at 13:xx IST with prep 10..44 min; one rider-implied ready excluded.
    for (let i = 0; i < 35; i++) {
      const acceptedAt = new Date(NOW.getTime() - (2 * 86_400_000) + i * 1000);
      await order(`TLM-P${i}`, { status: 'DELIVERED', placedAt: new Date(acceptedAt.getTime() - MIN), acceptedAt, readyAt: new Date(acceptedAt.getTime() + (10 + i) * MIN) });
    }
    const riderOnly = await order('TLM-PR', { status: 'DELIVERED', placedAt: new Date(NOW.getTime() - 86_400_000), acceptedAt: new Date(NOW.getTime() - 86_400_000), readyAt: new Date(NOW.getTime() - 86_400_000 + 100 * MIN) });
    await prisma.orderEvent.create({ data: { orderId: riderOnly.id, type: 'FOOD_READY', source: 'RIDER', dedupeKey: 'FOOD_READY', at: riderOnly.readyAt } });

    const res = await computePrepStats(NOW);
    expect(res.restaurants).toBeGreaterThanOrEqual(1);
    const all = await prisma.restaurantPrepStat.findUnique({ where: { restaurantId_hourBucket: { restaurantId: ids.rest, hourBucket: -1 } } });
    expect(all.samples).toBe(35);
    expect(all.p50Min).toBeCloseTo(27, 0);
    expect(all.p90Min).toBeGreaterThan(all.p60Min);
    const hour = await prisma.restaurantPrepStat.findUnique({ where: { restaurantId_hourBucket: { restaurantId: ids.rest, hourBucket: 13 } } });
    expect(hour.samples).toBe(35);

    const fresh = await order('TLM-PRED', { status: 'ACCEPTED', placedAt: NOW, acceptedAt: NOW });
    const pred = await predictPrepMinutes(fresh.id);
    expect(pred.source).toBe('hour');
    expect(pred.minutes).toBeCloseTo(all.p60Min, 1);
    expect(pred.quotedMin).toBe(25);
  });

  it('aggregates dispatch KPIs with SQL (assignment latency, waits, tap rate, on-time, batch, invites)', async () => {
    const { getDispatchInsights } = await import('@/server/dispatch/insights');
    const placed = new Date('2026-10-21T06:00:00Z');
    const t = (m: number) => new Date(placed.getTime() + m * MIN);
    const o = await order('TLM-K1', { status: 'DELIVERED', placedAt: placed, acceptedAt: t(1), readyAt: t(16), outForDeliveryAt: t(22), deliveredAt: t(40) });
    await prisma.riderAssignment.create({ data: { orderId: o.id, riderId: ids.rider, status: 'DELIVERED', assignedAt: t(18), claimedAt: t(18), pickedUpAt: t(22), deliveredAt: t(40) } });
    await prisma.orderDispatchPlan.create({ data: { orderId: o.id, restaurantId: ids.rest, predictedPrepMin: 12, prepSource: 'quoted', acceptedAt: t(1) } });
    await prisma.orderEvent.createMany({ data: [
      { orderId: o.id, type: 'FOOD_READY', source: 'KITCHEN', at: t(16), dedupeKey: 'FOOD_READY' },
      { orderId: o.id, type: 'INVITED', source: 'SYSTEM', at: t(16), dedupeKey: 'INVITED:pool' },
      { orderId: o.id, type: 'ASSIGNED', source: 'RIDER', at: t(18) },
      { orderId: o.id, type: 'ARRIVED_RESTAURANT', source: 'RIDER', at: t(20), dedupeKey: 'ARRIVED_RESTAURANT' },
    ] });
    await prisma.batchInvitation.create({ data: { orderId: o.id, riderId: ids.rider, status: 'DECLINED', detourKm: 1, invitedAt: t(16), expiresAt: t(17) } });
    // A late, never-tapped order (ready implied by rider) on the same day.
    const late = await order('TLM-K2', { status: 'DELIVERED', placedAt: t(5), acceptedAt: t(6), readyAt: t(50), deliveredAt: t(70) });
    await prisma.orderEvent.create({ data: { orderId: late.id, type: 'FOOD_READY', source: 'RIDER', at: t(50), dedupeKey: 'FOOD_READY' } });

    const r = await getDispatchInsights({ from: '2026-10-21', to: '2026-10-21', restaurantId: ids.rest }, { slaMin: 45, now: t(80) });
    expect(r.summary.orders).toBe(2);
    expect(r.summary.delivered).toBe(2);
    expect(r.summary.assignmentLatencyMin.p50).toBe(2); // 18 − 16
    expect(r.summary.riderWaitAtRestaurantMin.p50).toBe(2); // 22 − 20 (arrival)
    expect(r.summary.foodWaitingForRiderMin.p50).toBe(6); // 22 − 16
    expect(r.summary.prepError.maeMin).toBe(3); // (16−1) − 12
    expect(r.summary.prepError.samples).toBe(1);
    expect(r.summary.readyTapRatePct).toBe(50);
    expect(r.summary.onTimePct).toBe(50); // 40 ≤ 45 on time; 70−5=65 late
    expect(r.inviteAcceptance).toMatchObject({ invited: 1, declined: 1, ratePct: 0 });
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0].day).toBe('2026-10-21');
    expect(r.restaurants[0]).toMatchObject({ restaurantId: ids.rest, name: 'Telemetry Kitchen', orders: 2 });
  });

  it('counts live unassigned orders older than 5 minutes', async () => {
    const { getDispatchInsights } = await import('@/server/dispatch/insights');
    const now = new Date();
    await order('TLM-U1', { status: 'READY', placedAt: new Date(now.getTime() - 30 * MIN), readyAt: new Date(now.getTime() - 9 * MIN) });
    await order('TLM-U2', { status: 'READY', placedAt: new Date(now.getTime() - 30 * MIN), readyAt: new Date(now.getTime() - 2 * MIN) });
    const r = await getDispatchInsights({ from: '2026-10-21', to: '2026-10-21', restaurantId: ids.rest }, { slaMin: 45, includeZones: false, now });
    expect(r.unassignedOver5MinLive).toBe(1);
    await prisma.order.deleteMany({ where: { code: { in: ['TLM-U1', 'TLM-U2'] } } });
  });

  it('buckets open orders and riders by H3 res-8 and replaces a re-run bucket', async () => {
    const { runZoneSnapshot } = await import('@/server/dispatch/zones');
    await prisma.riderProfile.update({ where: { id: ids.rider }, data: { currentLat: 12.9716, currentLng: 77.5946 } });
    const open = await order('TLM-Z1', { status: 'PREPARING', placedAt: new Date(), fulfillmentType: 'DELIVERY' });
    const a = await runZoneSnapshot(new Date());
    const b = await runZoneSnapshot(new Date());
    expect(b.cells).toBe(a.cells);
    const rows = await prisma.zoneSupplyDemand.findMany({ where: { bucketAt: new Date(a.bucketAt) } });
    const cell = rows.find((r: any) => r.openOrders > 0);
    expect(cell.h3Cell).toMatch(/^88/);
    expect(cell.idleRiders).toBe(1);
    await prisma.order.delete({ where: { id: open.id } });
  });

  it('flags a stationary on-task rider once (debounced) and ignores one at the restaurant', async () => {
    const { runStationarySweep } = await import('@/server/dispatch/stationary');
    const now = new Date();
    const o = await order('TLM-S1', { status: 'OUT_FOR_DELIVERY', placedAt: new Date(now.getTime() - 40 * MIN) });
    await prisma.riderAssignment.create({ data: { orderId: o.id, riderId: ids.rider, status: 'PICKED_UP' } });
    // 12 min of fixes within ~10 m, 2 km from the restaurant.
    const pings = Array.from({ length: 13 }, (_, i) => ({ riderId: ids.rider, orderId: o.id, lat: 12.99 + (i % 2) * 0.00005, lng: 77.6, createdAt: new Date(now.getTime() - (12 - i) * MIN) }));
    await prisma.deliveryLocationPing.createMany({ data: pings });
    const cfg = { windowMin: 8, moveM: 50, geofenceM: 150, debounceMin: 30, maxFixAgeMin: 3 };
    const first = await runStationarySweep(now, cfg);
    expect(first.alerted).toBe(1);
    const esc = await prisma.orderEscalation.findFirst({ where: { orderId: o.id, type: 'RIDER_STATIONARY' } });
    expect(esc.message).toMatch(/stationary/);
    const second = await runStationarySweep(new Date(now.getTime() + 2 * MIN), cfg);
    expect(second.alerted).toBe(0);
    expect(second.debounced).toBe(1);
    await prisma.deliveryLocationPing.deleteMany({});
    await prisma.riderAssignment.deleteMany({ where: { orderId: o.id } });
  });

  it('JIT: plans on accept, holds until due, then releases into the pool (and READY does not re-push)', async () => {
    const { planDispatchOnAccept, runJitReleaseSweep, releasedPreReadyOrderIds, onFoodReady } = await import('@/server/dispatch/jit');
    const now = new Date();
    // Idle rider 1.5 km away → travel ≈ 6 min; predicted prep = P60 (~31 min) → hold.
    await prisma.riderProfile.update({ where: { id: ids.rider }, data: { currentLat: 12.985, currentLng: 77.5946 } });
    const o = await order('TLM-J1', { status: 'ACCEPTED', placedAt: now, acceptedAt: now, estimatedDeliveryAt: new Date(now.getTime() + 90 * MIN) });
    await planDispatchOnAccept(o.id, now);
    const plan = await prisma.orderDispatchPlan.findUnique({ where: { orderId: o.id } });
    expect(plan.jit).toBe(true);
    expect(plan.releasedAt).toBeNull();
    expect(plan.releaseAt.getTime()).toBeGreaterThan(now.getTime());

    const early = await runJitReleaseSweep(new Date(now.getTime() + MIN));
    expect(early).toMatchObject({ enabled: true, released: 0, held: 1 });
    // Keep the rider's fix "fresh" relative to the simulated clock.
    await prisma.$executeRaw`UPDATE "RiderProfile" SET "updatedAt" = (${plan.releaseAt}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${ids.rider}`;
    const due = await runJitReleaseSweep(new Date(plan.releaseAt.getTime() + 1000));
    expect(due.released).toBe(1);
    expect(due.byReason.jit_due).toBe(1);
    expect(await releasedPreReadyOrderIds()).toContain(o.id);
    const ev = await prisma.orderEvent.findFirst({ where: { orderId: o.id, type: 'INVITED' } });
    expect(ev.meta).toMatchObject({ preReady: true });
    expect(await onFoodReady(o.id)).toEqual({ alreadyNotified: true });
  });
});
