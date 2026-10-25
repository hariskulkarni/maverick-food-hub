/**
 * Rider liveness sweep.
 *
 * Riders ping POST /api/rider/heartbeat every ~30s while online. If we haven't
 * heard from them in 2 minutes (or never at all), we assume the app is dead /
 * backgrounded / phone is asleep and flip them offline so the dispatcher
 * doesn't try to assign new orders to a ghost.
 *
 * Never flips a rider who still has an active (accepted / picked-up) delivery:
 * the Home-tab heartbeat pauses when the app is backgrounded (e.g. rider is
 * navigating in Google Maps); the background location task refreshes
 * lastSeenAt via /api/rider/location, and the delivery must not be orphaned.
 *
 * Triggered from /api/platform/rider-heartbeat/sweep on a 1-minute cron.
 */
import { prisma } from './db';
import { isActiveDelivery } from './rider-location-points';

const STALE_MS = 2 * 60 * 1000; // 2 minutes

export async function runHeartbeatSweep(): Promise<{ flipped: number }> {
  const threshold = new Date(Date.now() - STALE_MS);

  // We want all online riders whose heartbeat is missing OR stale.
  // Fetch in two passes to avoid a complex relation filter that varies by
  // Prisma version: (a) online riders, then filter in JS using their heartbeat.
  const online = await prisma.riderProfile.findMany({
    where: { isOnline: true },
    select: { id: true }
  });
  if (online.length === 0) return { flipped: 0 };

  const riderIds = online.map((r) => r.id);
  const heartbeats = await prisma.riderHeartbeat.findMany({
    where: { riderId: { in: riderIds } },
    select: { riderId: true, lastSeenAt: true }
  });
  const lastSeen = new Map(heartbeats.map((h) => [h.riderId, h.lastSeenAt]));

  const stale: string[] = [];
  for (const r of online) {
    const seen = lastSeen.get(r.id);
    if (!seen || seen.getTime() < threshold.getTime()) stale.push(r.id);
  }
  if (stale.length === 0) return { flipped: 0 };

  const active = await prisma.riderAssignment.findMany({
    where: { riderId: { in: stale }, status: { in: ['ACCEPTED', 'PICKED_UP'] } },
    select: { riderId: true, status: true, order: { select: { status: true } } }
  });
  const delivering = new Set(
    active.filter((a) => isActiveDelivery(a.status, a.order.status)).map((a) => a.riderId)
  );
  const toFlip = stale.filter((id) => !delivering.has(id));
  if (toFlip.length === 0) return { flipped: 0 };

  const res = await prisma.riderProfile.updateMany({
    where: { id: { in: toFlip }, isOnline: true },
    data: { isOnline: false }
  });
  return { flipped: res.count };
}
