import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

/**
 * GET /api/platform/riders/live
 *
 * Super-admin only. Returns every rider currently `isOnline` with their latest
 * stored GPS position, so the /platform/live map can plot the whole fleet and
 * keep it fresh by polling — independent of the SSE firehose.
 *
 * `lastSeenAt` is the freshest signal we have for the rider: the GPS-fix time
 * (RiderHeartbeat.lastLocationAt) if the location stream is running, else the
 * heartbeat time, else when the profile row was last written.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requireSuperAdmin();

  const riders = await prisma.riderProfile.findMany({
    where: { isOnline: true },
    select: {
      id: true,
      currentLat: true,
      currentLng: true,
      riderType: true,
      currentLoad: true,
      updatedAt: true,
      user: { select: { name: true, phone: true } }
    }
  });

  // Heartbeats carry the most accurate "last GPS fix" / "last seen" times.
  const heartbeats = await prisma.riderHeartbeat.findMany({
    where: { riderId: { in: riders.map((r) => r.id) } },
    select: { riderId: true, lastSeenAt: true, lastLocationAt: true }
  });
  const hbById = new Map(heartbeats.map((h) => [h.riderId, h]));

  const result = riders
    // Only riders with a real stored position can be plotted precisely.
    .filter((r) => r.currentLat != null && r.currentLng != null)
    .map((r) => {
      const hb = hbById.get(r.id);
      const lastSeenAt = (hb?.lastLocationAt ?? hb?.lastSeenAt ?? r.updatedAt).toISOString();
      return {
        id: r.id,
        name: r.user?.name ?? 'Rider',
        phone: r.user?.phone ?? null,
        lat: r.currentLat!,
        lng: r.currentLng!,
        lastSeenAt,
        riderType: r.riderType,
        currentLoad: r.currentLoad
      };
    });

  return Response.json({ riders: result });
}
