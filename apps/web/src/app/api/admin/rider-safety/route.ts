/**
 * GET /api/admin/rider-safety
 *
 * Read-only safety feed for this restaurant's dedicated riders:
 *   • ACTIVE SosAlerts (+ recently resolved, last 24h, for context)
 *   • OPEN / UNDER_REVIEW RiderIncidentReports
 *
 * Scoped to RiderProfiles DEDICATED to the ADMIN's restaurant — a
 * restaurant only sees safety events for its own riders.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  // Riders dedicated to this restaurant.
  const riders = await prisma.riderProfile.findMany({
    where: { riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    include: { user: { select: { name: true, phone: true } } }
  });
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const riderIds = riders.map((r) => r.id);

  if (riderIds.length === 0) {
    return Response.json({ sosAlerts: [], incidents: [], riderCount: 0 });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [sos, incidents] = await Promise.all([
    prisma.sosAlert.findMany({
      where: {
        riderId: { in: riderIds },
        OR: [{ status: 'ACTIVE' }, { resolvedAt: { gte: since24h } }]
      },
      orderBy: { triggeredAt: 'desc' }
    }),
    prisma.riderIncidentReport.findMany({
      where: {
        riderId: { in: riderIds },
        status: { in: ['OPEN', 'UNDER_REVIEW'] }
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const riderInfo = (riderId: string) => {
    const r = riderById.get(riderId);
    return { name: r?.user?.name ?? null, phone: r?.user?.phone ?? null };
  };

  return Response.json({
    riderCount: riders.length,
    sosAlerts: sos.map((a) => ({
      id: a.id,
      riderId: a.riderId,
      rider: riderInfo(a.riderId),
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      note: a.note,
      triggeredAt: a.triggeredAt,
      resolvedAt: a.resolvedAt
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      riderId: i.riderId,
      rider: riderInfo(i.riderId),
      type: i.type,
      status: i.status,
      description: i.description,
      createdAt: i.createdAt
    }))
  });
}
