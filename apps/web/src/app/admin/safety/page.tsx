/**
 * Admin · Rider Safety
 *
 * Server component. Read-only safety visibility for the restaurant's
 * dedicated riders: ACTIVE (and recently resolved) SOS alerts plus open
 * incident reports. Scoped to RiderProfiles dedicated to this restaurant.
 *
 * The restaurant can't act on these here — resolving SOS and incidents is
 * the platform safety team's job — but they need to KNOW when one of their
 * riders is in trouble.
 */
import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { RiderSafetyClient } from './rider-safety-client';

export const metadata = { title: 'Admin · Rider Safety' };
export const dynamic = 'force-dynamic';

export default async function AdminSafetyPage() {
  const restaurant = await requireRestaurant();

  const riders = await prisma.riderProfile.findMany({
    where: { riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    include: { user: { select: { name: true, phone: true } } }
  });
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const riderIds = riders.map((r) => r.id);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [sos, incidents] =
    riderIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.sosAlert.findMany({
            where: {
              riderId: { in: riderIds },
              OR: [{ status: 'ACTIVE' }, { resolvedAt: { gte: since24h } }]
            },
            orderBy: { triggeredAt: 'desc' }
          }),
          prisma.riderIncidentReport.findMany({
            where: { riderId: { in: riderIds }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
            orderBy: { createdAt: 'desc' }
          })
        ]);

  const riderInfo = (riderId: string) => {
    const r = riderById.get(riderId);
    return { name: r?.user?.name ?? null, phone: r?.user?.phone ?? null };
  };

  const sosAlerts = sos.map((a) => ({
    id: a.id,
    rider: riderInfo(a.riderId),
    status: a.status,
    lat: a.lat,
    lng: a.lng,
    note: a.note,
    triggeredAt: a.triggeredAt,
    resolvedAt: a.resolvedAt
  }));

  const incidentRows = incidents.map((i) => ({
    id: i.id,
    rider: riderInfo(i.riderId),
    type: i.type,
    status: i.status,
    description: i.description,
    createdAt: i.createdAt
  }));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="display text-3xl font-semibold">Rider Safety</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live SOS alerts and open incident reports for riders dedicated to your restaurant. The platform
          safety team handles resolution — this view keeps you informed.
        </p>
      </header>

      <RiderSafetyClient
        initialSos={JSON.parse(JSON.stringify(sosAlerts))}
        initialIncidents={JSON.parse(JSON.stringify(incidentRows))}
        riderCount={riders.length}
      />
    </div>
  );
}
