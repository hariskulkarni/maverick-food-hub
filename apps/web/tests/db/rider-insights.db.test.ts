/**
 * Real-PostgreSQL proof of rider operational insights end to end: the rider
 * endpoints (online toggle, heartbeat with device context, location batches)
 * and the heartbeat sweep record status events / device snapshots; delivered
 * assignments get a reconstructed path summary; the insights loader turns it
 * into today/7-day stats; and retention prunes only expired raw rows.
 * Only auth and the realtime fan-out are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/realtime', () => ({ publish: () => {} }));
vi.mock('@/server/platform-settings', async (orig) => ({
  ...(await orig<typeof import('@/server/platform-settings')>()),
  getRiderKycGate: async () => true,
}));

import { prisma } from '@/server/db';
import { POST as setOnline } from '@/app/api/rider/online/route';
import { POST as heartbeat } from '@/app/api/rider/heartbeat/route';
import { POST as location } from '@/app/api/rider/location/route';
import { runHeartbeatSweep } from '@/server/rider-heartbeat';
import { runTripSummaries } from '@/server/rider-insights/trips';
import { getRiderInsights, getDeliveryPath } from '@/server/rider-insights/service';
import { runRiderInsightsRetention } from '@/server/rider-insights/retention';
import { approveAllKyc, makeAssignment, makeOrder, makeRestaurant, makeRider } from './rider-fixtures';

const post = (body: unknown) =>
  new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function onlineRider() {
  const { user, profile } = await makeRider({ online: false });
  await approveAllKyc(profile.id);
  session = { user: { id: user.id, role: 'RIDER' } };
  expect((await setOnline(post({ online: true }))).status).toBe(200);
  return { user, profile };
}

const events = (riderId: string) =>
  prisma.riderStatusEvent.findMany({ where: { riderId }, orderBy: { at: 'asc' } }).then((r) => r.map((e) => e.type));

const device = { model: 'samsung SM-A515F', osName: 'Android', osVersion: '13', appVersion: '1.4.0', appBuild: '42', network: 'CELLULAR', cellGen: '4g', battery: 64, charging: false };

beforeEach(() => {
  session = null;
});

describe('status events', () => {
  it('online/offline toggles record one event per transition', async () => {
    const { profile } = await onlineRider();
    await setOnline(post({ online: true }));
    await setOnline(post({ online: false }));
    expect(await events(profile.id)).toEqual(['ONLINE', 'OFFLINE']);
  });

  it('sweep: silent idle rider → AUTO_OFFLINE; silent delivering rider → SIGNAL_LOST, then SIGNAL_REGAINED on the next ping', async () => {
    const idle = await onlineRider();
    const busy = await onlineRider();
    const { branch } = await makeRestaurant();
    const { order } = await makeOrder(branch.id, { status: 'OUT_FOR_DELIVERY' as any });
    await makeAssignment({ orderId: order.id, riderId: busy.profile.id, status: 'PICKED_UP', acceptedAt: new Date(), pickedUpAt: new Date() });
    const old = new Date(Date.now() - 5 * 60_000);
    await prisma.riderHeartbeat.updateMany({ where: { riderId: { in: [idle.profile.id, busy.profile.id] } }, data: { lastSeenAt: old } });

    await runHeartbeatSweep();
    await runHeartbeatSweep(); // a second pass must not duplicate SIGNAL_LOST
    expect(await events(idle.profile.id)).toEqual(['ONLINE', 'AUTO_OFFLINE']);
    expect(await events(busy.profile.id)).toEqual(['ONLINE', 'SIGNAL_LOST']);
    expect((await prisma.riderHeartbeat.findUniqueOrThrow({ where: { riderId: busy.profile.id } })).signalLostAt).not.toBeNull();

    session = { user: { id: busy.user.id, role: 'RIDER' } };
    const now = Date.now();
    expect((await location(post({ points: [{ lat: 18.52, lng: 73.85, recordedAt: now, orderId: order.id }], sentAt: now }))).status).toBe(200);
    const after = await until(() => events(busy.profile.id), (e) => e.length === 3);
    expect(after).toEqual(['ONLINE', 'SIGNAL_LOST', 'SIGNAL_REGAINED']);
    expect((await prisma.riderHeartbeat.findUniqueOrThrow({ where: { riderId: busy.profile.id } })).signalLostAt).toBeNull();
  });
});

describe('device context', () => {
  it('heartbeat stores the latest snapshot and a thinned history; forbidden fields are dropped', async () => {
    const { profile } = await onlineRider();
    expect((await heartbeat(post({ gpsEnabled: true, device }))).status).toBe(200);
    await heartbeat(post({ gpsEnabled: true, device: { ...device, battery: 63 } })); // within 5 min, same network → no new sample
    await heartbeat(post({ gpsEnabled: true, device: { ...device, network: 'WIFI', battery: 62 } })); // network change → sample
    await heartbeat(post({ gpsEnabled: true, device: { ...device, imei: '356938035643809', battery: 1 } })); // invalid → ignored

    const snap = await prisma.riderDeviceSnapshot.findUniqueOrThrow({ where: { riderId: profile.id } });
    expect(snap).toMatchObject({ deviceModel: 'samsung SM-A515F', osName: 'Android', networkType: 'WIFI', cellularGeneration: null, batteryLevel: 62 });
    expect(await prisma.riderDeviceSample.count({ where: { riderId: profile.id } })).toBe(2);
    const hb = await prisma.riderHeartbeat.findUniqueOrThrow({ where: { riderId: profile.id } });
    expect(hb.batteryLevel).toBe(62);
    expect(hb.appVersion).toBe('1.4.0');
  });

  it('a background location batch carries device context; an offline rider stores none', async () => {
    const { user, profile } = await onlineRider();
    const now = Date.now();
    await location(post({ points: [{ lat: 18.52, lng: 73.85, recordedAt: now }], sentAt: now, device: { battery: 15, charging: true, network: 'CELLULAR', cellGen: '5g' } }));
    const snap = await until(() => prisma.riderDeviceSnapshot.findUnique({ where: { riderId: profile.id } }), (s) => !!s);
    expect(snap).toMatchObject({ batteryLevel: 15, charging: true, cellularGeneration: '5g' });

    const off = await makeRider({ online: false });
    session = { user: { id: off.user.id, role: 'RIDER' } };
    await heartbeat(post({ device }));
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.riderDeviceSnapshot.findUnique({ where: { riderId: off.profile.id } })).toBeNull();
    void user;
  });
});

describe('paths and stats', () => {
  it('summarises a delivered trip and reports today/7-day stats', async () => {
    const { profile } = await onlineRider();
    const { branch } = await makeRestaurant();
    const { order } = await makeOrder(branch.id, { status: 'DELIVERED' as any });
    const start = Date.now() - 40 * 60_000;
    const delivered = new Date(start + 20 * 60_000);
    const a = await makeAssignment(
      { orderId: order.id, riderId: profile.id, status: 'DELIVERED', acceptedAt: new Date(start), pickedUpAt: new Date(start + 5 * 60_000), deliveredAt: delivered },
      false
    );
    // 3 km north in 300 m steps, one per minute, plus one GPS jump (dropped).
    const north = (m: number) => 18.52 + m / 111_195;
    const rows = Array.from({ length: 11 }, (_, i) => ({ riderId: profile.id, orderId: order.id, lat: north(i * 300), lng: 73.85, createdAt: new Date(start + i * 60_000) }));
    rows.push({ riderId: profile.id, orderId: order.id, lat: 19.5, lng: 73.85, createdAt: new Date(start + 5 * 60_000 + 30_000) });
    await prisma.deliveryLocationPing.createMany({ data: rows });

    const res = await runTripSummaries();
    expect(res.summarized).toBeGreaterThanOrEqual(1);
    const s = await prisma.riderTripSummary.findUniqueOrThrow({ where: { assignmentId: a.id } });
    expect(s.distanceM).toBeGreaterThan(2980);
    expect(s.distanceM).toBeLessThan(3020);
    expect(s.durationSec).toBe(600);
    expect(s.droppedPoints).toBe(1);
    expect(s.maxGapSec).toBe(60);

    const path = await getDeliveryPath(profile.id, a.id);
    expect(path?.points).toHaveLength(11);
    expect(path?.pickup).toMatchObject({ lat: 18.52, lng: 73.85 });
    expect(await getDeliveryPath('someone-else', a.id)).toBeNull();

    const ins = await getRiderInsights(profile.id);
    expect(ins?.status.isOnline).toBe(true);
    expect(ins?.stats.week.deliveries).toBe(1);
    expect(ins?.stats.week.distanceM).toBeGreaterThan(2900);
    expect(ins?.stats.week.onlineMs).toBeGreaterThan(0);
    expect(ins?.deliveries[0].summary?.distanceM).toBe(s.distanceM);
    expect(ins?.timeline[0].type).toBe('ONLINE');
  });
});

describe('retention', () => {
  it('prunes expired breadcrumbs, events and device history but keeps fresh rows and trip summaries', async () => {
    const { profile } = await makeRider({ online: true });
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
    await prisma.deliveryLocationPing.createMany({
      data: [
        { riderId: profile.id, lat: 1, lng: 1, createdAt: daysAgo(91) },
        { riderId: profile.id, lat: 1, lng: 1, createdAt: daysAgo(95) },
        { riderId: profile.id, lat: 1, lng: 1, createdAt: daysAgo(10) },
      ],
    });
    await prisma.riderStatusEvent.createMany({
      data: [
        { riderId: profile.id, type: 'ONLINE', at: daysAgo(100) },
        { riderId: profile.id, type: 'OFFLINE', at: daysAgo(5) },
      ],
    });
    await prisma.riderDeviceSample.createMany({
      data: [
        { riderId: profile.id, batteryLevel: 10, capturedAt: daysAgo(31) },
        { riderId: profile.id, batteryLevel: 20, capturedAt: daysAgo(2) },
      ],
    });
    await prisma.riderDeviceSnapshot.create({ data: { riderId: profile.id, batteryLevel: 5, capturedAt: daysAgo(120) } });
    const summariesBefore = await prisma.riderTripSummary.count();

    const res = await runRiderInsightsRetention();
    expect(res.deleted.breadcrumbs).toBeGreaterThanOrEqual(2);
    expect(await prisma.deliveryLocationPing.count({ where: { riderId: profile.id } })).toBe(1);
    expect(await prisma.riderStatusEvent.findMany({ where: { riderId: profile.id }, select: { type: true } })).toEqual([{ type: 'OFFLINE' }]);
    expect(await prisma.riderDeviceSample.findMany({ where: { riderId: profile.id }, select: { batteryLevel: true } })).toEqual([{ batteryLevel: 20 }]);
    expect(await prisma.riderDeviceSnapshot.findUnique({ where: { riderId: profile.id } })).toBeNull();
    expect(await prisma.riderTripSummary.count()).toBeGreaterThanOrEqual(summariesBefore);
  });
});
