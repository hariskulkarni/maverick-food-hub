import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { publish } from '@/server/realtime';
import { maybePublishNearby } from '@/server/proximity';

/**
 * High-frequency rider location ping.
 *
 * - Publishes to SSE every call (sub-second propagation to all subscribers).
 * - Throttles DB writes to once per ~3 seconds per rider to avoid hammering
 *   Postgres. The in-process throttle works for single-instance deploys; swap
 *   to Redis if/when this runs behind multiple workers.
 */

const Body = z.object({
  lat: z.number(),
  lng: z.number(),
  speedKph: z.number().optional(),
  orderId: z.string().optional()
});

// In-memory throttle bookkeeping. Resets across deploys (acceptable).
const lastPersistAt = new Map<string, number>(); // riderId → ms
const lastBranchAt  = new Map<string, number>(); // riderId → ms (for last known branchId on this assignment)
// Cache of order → drop coords so we can compute proximity without a DB hit
// on every ping. Lifetime matches lastBranchAt — refreshed every 30s.
const dropCache = new Map<string, { branchId: string | null; drop: { lat: number; lng: number } | null }>();
const DB_THROTTLE_MS = 3_000;

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const data = Body.parse(await req.json());

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true }
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const at = new Date().toISOString();
  const event = {
    kind: 'rider:position' as const,
    riderId: profile.id,
    lat: data.lat,
    lng: data.lng,
    speedKph: data.speedKph,
    orderId: data.orderId,
    at
  };

  // Fast fan-out paths — every single ping reaches subscribers immediately.
  publish(`rider:${profile.id}:location`, event);
  publish('platform:riders', event);

  if (data.orderId) {
    // Customer tracker channel — keep old `location` shape so existing
    // subscribers don't need to change.
    publish(`order:${data.orderId}`, { kind: 'location', orderId: data.orderId, lat: data.lat, lng: data.lng, at });

    // Restaurant branch feed + drop coords: only refresh from DB every 30s.
    // We cache the order's drop lat/lng alongside the branchId so the
    // proximity check below avoids hitting Postgres on every ping.
    const branchAt = lastBranchAt.get(profile.id) ?? 0;
    let cached = dropCache.get(data.orderId);
    if (!cached || Date.now() - branchAt > 30_000) {
      const o = await prisma.order.findUnique({
        where: { id: data.orderId },
        select: { branchId: true, address: { select: { latitude: true, longitude: true } } }
      });
      const drop = o?.address?.latitude != null && o.address?.longitude != null
        ? { lat: Number(o.address.latitude), lng: Number(o.address.longitude) }
        : null;
      cached = { branchId: o?.branchId ?? null, drop };
      dropCache.set(data.orderId, cached);
      if (cached.branchId) {
        (event as any).branchId = cached.branchId;
        publish(`branch:${cached.branchId}:riders`, event);
        lastBranchAt.set(profile.id, Date.now());
      }
    } else {
      // Re-publish using last-known branch info attached to the event payload.
      publish(`branch:_:riders`, event);
    }

    // Proximity broadcast — fires once per order per 5-minute window when the
    // rider crosses inside 200m of the drop. The helper handles the dedupe.
    if (cached?.drop) {
      maybePublishNearby(data.orderId, { lat: data.lat, lng: data.lng }, cached.drop);
    }
  }

  // Throttled DB persistence — keeps the current position fresh on the rider
  // profile but doesn't flood DeliveryLocationPing.
  const last = lastPersistAt.get(profile.id) ?? 0;
  const now = Date.now();
  if (now - last >= DB_THROTTLE_MS) {
    lastPersistAt.set(profile.id, now);
    const nowDate = new Date();
    // Fire-and-forget: do not block the SSE-publish acknowledgment behind disk I/O.
    Promise.all([
      // Source of truth for the super-admin live map between SSE frames.
      // `@updatedAt` on RiderProfile bumps automatically, so the freshness of
      // currentLat/currentLng is observable via `updatedAt`.
      prisma.riderProfile.update({ where: { id: profile.id }, data: { currentLat: data.lat, currentLng: data.lng } }),
      prisma.deliveryLocationPing.create({
        data: { riderId: profile.id, orderId: data.orderId, lat: data.lat, lng: data.lng, speedKph: data.speedKph }
      }),
      // Stamp lastLocationAt on the heartbeat row so the live endpoint can
      // report an accurate "last GPS fix" time even when the rider is idle
      // (no active order) and only the location stream is running.
      prisma.riderHeartbeat.upsert({
        where: { riderId: profile.id },
        create: { riderId: profile.id, lastSeenAt: nowDate, lastLocationAt: nowDate, gpsEnabled: true },
        update: { lastLocationAt: nowDate }
      })
    ]).catch(() => {});
  }

  return Response.json({ ok: true });
}
