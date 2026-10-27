import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { publish } from '@/server/realtime';
import { maybePublishNearby } from '@/server/proximity';
import { maybeEmitArrival } from '@/server/arrival';
import { parseOrJsonError } from '@/server/zod-helpers';
import {
  LocationBody,
  bodyPoints,
  classifyPoints,
  pointsToPersist,
  isActiveDelivery
} from '@/server/rider-location-points';
import { parseDevice, recordDeviceContext } from '@/server/rider-insights/device';
import { markSignalRegained } from '@/server/rider-insights/status-events';
import { runLocationIntegrity } from '@/server/rider-integrity/service';

/**
 * Rider location ping — one point from the foreground app, or a batch of up to
 * 50 (`{ points: [...] }`) flushed by the native app's background
 * delivery-tracking task (incl. points queued while the phone was offline).
 *
 * - Out-of-order / duplicate / far-stale points are ignored (see
 *   server/rider-location-points.ts). Only the newest fresh point is "live":
 *   it is published over SSE (customer tracker, branch feed, platform live-ops)
 *   and becomes RiderProfile.currentLat/Lng (read by live-ops, ETA and
 *   /trip/<token>).
 * - An `orderId` is honoured only when that order's assignment belongs to this
 *   rider (else the point is an untagged fleet ping), and order-scoped
 *   channels (order:/branch:, proximity, arrival) are fed only while that
 *   assignment is still active. Never 403 for this: the background task
 *   treats 403 as "signed out".
 * - Every request with accepted points refreshes RiderHeartbeat.lastSeenAt.
 * - Accepted points go into DeliveryLocationPing (the route trail) thinned to
 *   one per ~3 s per rider, stamped with their fix time.
 * - Rider insights: an optional `device` context (see
 *   server/rider-insights/device.ts) is stored while the rider is online, and a
 *   post with accepted points clears a sweep-set "signal lost" mark
 *   (SIGNAL_REGAINED). Both are fire-and-forget and never fail the ping.
 * - The response carries `orderActive` for the newest tagged point so the
 *   background task can stop itself once the delivery is over.
 *
 * In-process maps assume a single instance (as before); swap to Redis if this
 * ever runs behind multiple workers.
 */

type OrderInfo = {
  riderId: string;
  assignmentStatus: string;
  orderStatus: string;
  branchId: string | null;
  pickup: { lat: number; lng: number } | null;
  drop: { lat: number; lng: number } | null;
  at: number;
};

const ORDER_CACHE_MS = 30_000;
const orderCache = new Map<string, OrderInfo>(); // orderId → assignment + coords
const lastAcceptedAt = new Map<string, number>(); // riderId → newest accepted fix time
const lastPersistedAt = new Map<string, number>(); // riderId → newest persisted fix time

async function loadOrder(orderId: string): Promise<OrderInfo | null> {
  const cached = orderCache.get(orderId);
  if (cached && Date.now() - cached.at < ORDER_CACHE_MS) return cached;
  const a = await prisma.riderAssignment.findUnique({
    where: { orderId },
    select: {
      riderId: true,
      status: true,
      order: {
        select: {
          status: true,
          branchId: true,
          branch: { select: { latitude: true, longitude: true } },
          address: { select: { latitude: true, longitude: true } }
        }
      }
    }
  });
  if (!a) {
    orderCache.delete(orderId);
    return null;
  }
  const o = a.order;
  const info: OrderInfo = {
    riderId: a.riderId,
    assignmentStatus: a.status,
    orderStatus: o.status,
    branchId: o.branchId ?? null,
    pickup:
      o.branch?.latitude != null && o.branch?.longitude != null
        ? { lat: Number(o.branch.latitude), lng: Number(o.branch.longitude) }
        : null,
    drop:
      o.address?.latitude != null && o.address?.longitude != null
        ? { lat: Number(o.address.latitude), lng: Number(o.address.longitude) }
        : null,
    at: Date.now()
  };
  orderCache.set(orderId, info);
  return info;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseOrJsonError(LocationBody, raw);
  if (parsed instanceof Response) return parsed;

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true }
  });
  if (!profile) return new Response('No rider profile', { status: 404 });
  const riderId = profile.id;

  // Resolve each referenced order once; keep only the rider's own.
  const { points: allPoints, sentAt, device: rawDevice } = bodyPoints(parsed);
  const device = parseDevice(rawDevice);
  if (device) void recordDeviceContext(riderId, device);
  // Location-integrity: a ping the OS reported as mocked (fake GPS) is NEVER
  // used as a live position — it is dropped here and handled (counted, scored,
  // flagged) by runLocationIntegrity below. Everything downstream positions the
  // rider from the real fixes only.
  const mockedPoints = allPoints.filter((p) => p.mocked);
  const points = allPoints.filter((p) => !p.mocked);
  const owned = new Map<string, OrderInfo>();
  for (const orderId of new Set(points.map((p) => p.orderId).filter((x): x is string => !!x))) {
    const info = await loadOrder(orderId);
    if (info && info.riderId === riderId) owned.set(orderId, info);
  }
  const scoped = points.map((p) => (p.orderId && !owned.has(p.orderId) ? { ...p, orderId: undefined } : p));

  // orderActive answers for the newest point that named an order.
  let newestTagged: { orderId: string; t: number } | null = null;
  for (const p of points) {
    if (!p.orderId) continue;
    const t = p.recordedAt ?? Number.MAX_SAFE_INTEGER;
    if (!newestTagged || t >= newestTagged.t) newestTagged = { orderId: p.orderId, t };
  }
  let orderActive: boolean | undefined;
  if (newestTagged) {
    const info = owned.get(newestTagged.orderId);
    orderActive = !!info && isActiveDelivery(info.assignmentStatus, info.orderStatus);
  }

  const now = Date.now();
  const { accepted, live, lastAcceptedAt: mark } = classifyPoints(scoped, now, lastAcceptedAt.get(riderId), sentAt);
  if (mark !== undefined) lastAcceptedAt.set(riderId, mark);

  // ── Location-integrity (anti-fraud) ───────────────────────────────────────
  // Score mocked pings + movement heuristics over the newly accepted real
  // fixes. Fire-and-forget: a fraud check never blocks the ack. Device-clock
  // skew is the drift the server would apply to the sender's timestamps.
  if (accepted.length > 0 || mockedPoints.length > 0) {
    const timedPoints = [
      ...accepted.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, accuracy: p.accuracy })),
      ...mockedPoints.map((p) => ({ lat: p.lat, lng: p.lng, t: p.recordedAt ?? now, accuracy: p.accuracy, mocked: true as const })),
    ];
    void runLocationIntegrity({
      riderId,
      orderId: live?.orderId ?? null,
      timedPoints,
      driftMs: sentAt !== undefined ? now - sentAt : undefined,
      now: new Date(now),
    });
  }

  // ── Live fan-out (newest fresh point only) ────────────────────────────────
  if (live) {
    const at = new Date(Math.min(live.t, now)).toISOString();
    const event = {
      kind: 'rider:position' as const,
      riderId,
      lat: live.lat,
      lng: live.lng,
      speedKph: live.speedKph,
      orderId: live.orderId,
      at
    };
    publish(`rider:${riderId}:location`, event);
    publish('platform:riders', event);

    // Order-scoped channels only for the rider's own ACTIVE delivery — a
    // finished, cancelled or someone else's order never gets positions,
    // proximity or arrival events from this rider.
    const info = live.orderId ? owned.get(live.orderId) : undefined;
    if (live.orderId && info && isActiveDelivery(info.assignmentStatus, info.orderStatus)) {
      // Customer tracker channel — keep the old `location` shape.
      publish(`order:${live.orderId}`, { kind: 'location', orderId: live.orderId, lat: live.lat, lng: live.lng, at });
      if (info.branchId) {
        // Branch feed carries the branchId alongside the rider position.
        publish(`branch:${info.branchId}:riders`, Object.assign({}, event, { branchId: info.branchId }));
      }
      // Proximity broadcast (200 m of the drop, deduped by the helper).
      if (info.drop) maybePublishNearby(live.orderId, { lat: live.lat, lng: live.lng }, info.drop);
      // Geofence arrival (pickup/dropoff) — idempotent; never blocks the ack.
      void maybeEmitArrival(live.orderId, { lat: live.lat, lng: live.lng }, info.pickup, info.drop).catch(() => {});
    }
  }

  // ── Persistence (thinned trail + current position) ────────────────────────
  const { persist, lastPersistedAt: pmark } = pointsToPersist(accepted, lastPersistedAt.get(riderId));
  if (pmark !== undefined) lastPersistedAt.set(riderId, pmark);
  if (persist.length > 0) {
    const nowDate = new Date(now);
    const writes: Promise<unknown>[] = [
      prisma.deliveryLocationPing.createMany({
        data: persist.map((p) => ({
          riderId,
          orderId: p.orderId,
          lat: p.lat,
          lng: p.lng,
          speedKph: p.speedKph,
          createdAt: new Date(Math.min(p.t, now))
        }))
      })
    ];
    // Any accepted point (incl. a background batch) proves the app is alive:
    // refresh lastSeenAt so the auto-offline sweep doesn't flip a rider whose
    // Home-tab heartbeat interval is paused in the background.
    // lastLocationAt (the "last GPS fix" on the live maps) moves only together
    // with RiderProfile.currentLat/Lng and carries the fix time, so the poll
    // never pairs an old stored position with a newer timestamp.
    const storedLive = live && persist.includes(live) ? live : null;
    const fixAt = storedLive ? new Date(Math.min(storedLive.t, now)) : null;
    writes.push(
      prisma.riderHeartbeat.upsert({
        where: { riderId },
        create: { riderId, lastSeenAt: nowDate, lastLocationAt: fixAt, gpsEnabled: true },
        update: fixAt ? { lastSeenAt: nowDate, lastLocationAt: fixAt } : { lastSeenAt: nowDate }
      })
    );
    if (storedLive) {
      // Source of truth for the live maps between SSE frames.
      writes.push(
        prisma.riderProfile.update({ where: { id: riderId }, data: { currentLat: storedLive.lat, currentLng: storedLive.lng } })
      );
    }
    writes.push(markSignalRegained(riderId, 'location'));
    // Fire-and-forget: never block the ack behind disk I/O.
    Promise.all(writes).catch(() => {});
  }

  return Response.json({
    ok: true,
    accepted: accepted.length,
    ...(orderActive !== undefined ? { orderActive } : {})
  });
}
