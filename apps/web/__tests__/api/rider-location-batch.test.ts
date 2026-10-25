/**
 * POST /api/rider/location — single pings (foreground app) and batches from
 * the native background delivery-tracking task: validation, rider/order
 * scoping, stale / out-of-order handling, live fan-out and orderActive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const published: { channel: string; event: any }[] = [];
const pings: any[] = [];
const profileUpdates: any[] = [];
const heartbeats: any[] = [];
let sessionRole = 'RIDER';
let sessionUser = 'u1';

// orderId -> assignment row
const assignments: Record<string, any> = {
  o1: { riderId: 'r1', status: 'PICKED_UP', order: { status: 'OUT_FOR_DELIVERY', branchId: 'b1', branch: { latitude: 12.9, longitude: 77.5 }, address: { latitude: 12.95, longitude: 77.6 } } },
  oDone: { riderId: 'r1', status: 'DELIVERED', order: { status: 'DELIVERED', branchId: 'b1', branch: null, address: null } },
  oOther: { riderId: 'r2', status: 'ACCEPTED', order: { status: 'RIDER_ASSIGNED', branchId: 'b9', branch: null, address: null } }
};

vi.mock('@/server/rider-auth', () => ({
  auth: async () => ({ user: { id: sessionUser, role: sessionRole } })
}));
vi.mock('@/server/realtime', () => ({
  publish: (channel: string, event: unknown) => { published.push({ channel, event }); }
}));
vi.mock('@/server/proximity', () => ({ maybePublishNearby: () => {} }));
vi.mock('@/server/arrival', () => ({ maybeEmitArrival: async () => {} }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: {
      findUnique: async ({ where }: any) => (where.userId === 'u1' ? { id: 'r1' } : where.userId === 'u2' ? { id: 'r2' } : null),
      update: async (args: any) => { profileUpdates.push(args); return {}; }
    },
    riderAssignment: { findUnique: async ({ where }: any) => assignments[where.orderId] ?? null },
    deliveryLocationPing: { createMany: async ({ data }: any) => { pings.push(...data); return { count: data.length }; } },
    riderHeartbeat: { upsert: async (args: any) => { heartbeats.push(args); return {}; } }
  }
}));

const req = (body: unknown) => ({ json: async () => body }) as any;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function freshRoute() {
  vi.resetModules();
  return (await import('@/app/api/rider/location/route')).POST;
}

beforeEach(() => {
  published.length = 0;
  pings.length = 0;
  profileUpdates.length = 0;
  heartbeats.length = 0;
  sessionRole = 'RIDER';
  sessionUser = 'u1';
});

describe('/api/rider/location', () => {
  it('rejects non-riders and invalid bodies', async () => {
    const POST = await freshRoute();
    sessionRole = 'CUSTOMER';
    expect((await POST(req({ lat: 1, lng: 2 }))).status).toBe(403);
    sessionRole = 'RIDER';
    expect((await POST(req({ lat: 200, lng: 2 }))).status).toBe(400);
    expect((await POST(req({ points: [] }))).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => ({ lat: 1, lng: 2 }));
    expect((await POST(req({ points: tooMany }))).status).toBe(400);
  });

  it('keeps the legacy single-ping shape working (no recordedAt)', async () => {
    const POST = await freshRoute();
    const res = await POST(req({ lat: 12.91, lng: 77.51, orderId: 'o1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, accepted: 1, orderActive: true });
    expect(published.map((p) => p.channel)).toEqual(
      expect.arrayContaining(['rider:r1:location', 'platform:riders', 'order:o1', 'branch:b1:riders'])
    );
    await flush();
    expect(pings).toHaveLength(1);
    expect(profileUpdates[0].data).toEqual({ currentLat: 12.91, currentLng: 77.51 });
  });

  it('accepts a background batch: persists the trail in order, publishes only the newest point', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    const points = [
      { lat: 12.93, lng: 77.53, orderId: 'o1', recordedAt: now - 10_000 },
      { lat: 12.91, lng: 77.51, orderId: 'o1', recordedAt: now - 40_000 },
      { lat: 12.92, lng: 77.52, orderId: 'o1', recordedAt: now - 25_000 }
    ];
    const res = await POST(req({ points, sentAt: now }));
    expect(await res.json()).toMatchObject({ ok: true, accepted: 3, orderActive: true });
    const orderEvents = published.filter((p) => p.channel === 'order:o1');
    expect(orderEvents).toHaveLength(1);
    expect(orderEvents[0].event).toMatchObject({ lat: 12.93, lng: 77.53 });
    await flush();
    expect(pings.map((p) => p.lat)).toEqual([12.91, 12.92, 12.93]);
    expect(pings[0].createdAt.getTime()).toBeLessThan(pings[2].createdAt.getTime());
  });

  it('ignores out-of-order and duplicate points after newer ones', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    await POST(req({ lat: 12.95, lng: 77.55, orderId: 'o1', recordedAt: now - 1_000, sentAt: now }));
    published.length = 0;
    const res = await POST(req({ points: [
      { lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: now - 5_000 },
      { lat: 12.95, lng: 77.55, orderId: 'o1', recordedAt: now - 1_000 }
    ], sentAt: now }));
    expect((await res.json()).accepted).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('stores stale queued points as trail but never as the live position', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    const res = await POST(req({ points: [
      { lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: now - 30 * 60_000 },
      { lat: 12.91, lng: 77.51, orderId: 'o1', recordedAt: now - 20 * 60_000 },
      { lat: 1, lng: 1, orderId: 'o1', recordedAt: now - 7 * 60 * 60_000 } // beyond max age
    ], sentAt: now }));
    expect((await res.json()).accepted).toBe(2);
    expect(published).toHaveLength(0);
    await flush();
    expect(pings).toHaveLength(2);
    expect(profileUpdates).toHaveLength(0);
  });

  it('corrects a wrong phone clock using sentAt', async () => {
    const POST = await freshRoute();
    const phoneNow = Date.now() - 60 * 60_000; // phone is an hour behind
    await POST(req({ points: [{ lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: phoneNow - 5_000 }], sentAt: phoneNow }));
    expect(published.some((p) => p.channel === 'order:o1')).toBe(true);
  });

  it("does not let a rider publish into another rider's order", async () => {
    const POST = await freshRoute();
    const res = await POST(req({ lat: 12.9, lng: 77.5, orderId: 'oOther' }));
    expect(await res.json()).toMatchObject({ ok: true, orderActive: false });
    expect(published.some((p) => p.channel.startsWith('order:') || p.channel.startsWith('branch:'))).toBe(false);
    await flush();
    expect(pings[0].orderId).toBeUndefined();
  });

  it('reports orderActive=false once the delivery is finished', async () => {
    const POST = await freshRoute();
    const res = await POST(req({ lat: 12.9, lng: 77.5, orderId: 'oDone' }));
    expect((await res.json()).orderActive).toBe(false);
    // A finished order's tracking channel gets nothing from the rider any more.
    expect(published.some((p) => p.channel.startsWith('order:') || p.channel.startsWith('branch:'))).toBe(false);
  });

  it('refreshes lastSeenAt on every accepted post, including stale background batches', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    await POST(req({ points: [{ lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: now - 20 * 60_000 }], sentAt: now }));
    await flush();
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0].update.lastSeenAt).toBeInstanceOf(Date);
    expect(heartbeats[0].update.lastLocationAt).toBeUndefined(); // stale → not a live fix
    await POST(req({ lat: 12.91, lng: 77.51, orderId: 'o1', recordedAt: now, sentAt: now }));
    await flush();
    expect(heartbeats[1].update.lastLocationAt).toBeInstanceOf(Date);
  });

  it('stamps lastLocationAt with the live fix time, written together with the stored position', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    await POST(req({ lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: now - 20_000, sentAt: now }));
    await flush();
    expect(profileUpdates).toHaveLength(1);
    expect(profileUpdates[0].data).toEqual({ currentLat: 12.9, currentLng: 77.5 });
    // The live map shows "last fix" from this — it must be when the fix was
    // taken, not when the request arrived.
    expect(heartbeats[0].update.lastLocationAt.getTime()).toBe(now - 20_000);
  });

  it('does not advance lastLocationAt when the live point itself was not stored', async () => {
    const POST = await freshRoute();
    const now = Date.now();
    // Oldest point is stored; the newest (live) one is within the 3 s trail
    // spacing, so RiderProfile.currentLat/Lng is NOT updated — the fix time
    // must not move either, or the poll would pair an old position with a new time.
    await POST(req({ points: [
      { lat: 12.9, lng: 77.5, orderId: 'o1', recordedAt: now - 2_500 },
      { lat: 12.91, lng: 77.51, orderId: 'o1', recordedAt: now - 1_000 }
    ], sentAt: now }));
    await flush();
    expect(profileUpdates).toHaveLength(0);
    expect(heartbeats[0].update.lastLocationAt).toBeUndefined();
    expect(heartbeats[0].update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('omits orderActive for untagged fleet pings', async () => {
    const POST = await freshRoute();
    const body = await (await POST(req({ lat: 12.9, lng: 77.5 }))).json();
    expect(body.orderActive).toBeUndefined();
    expect(published.map((p) => p.channel)).toEqual(['rider:r1:location', 'platform:riders']);
  });
});
