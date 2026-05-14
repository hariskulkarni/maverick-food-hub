/**
 * Admin · Dedicated Riders
 *
 * Server component. Resolves the ADMIN's restaurant, loads its current
 * dispatch settings and dedicated-rider roster, and hands a
 * JSON-serialisable payload to the client component for editing.
 *
 * Riders are platform-level RiderProfile records — a rider is either FLEET
 * (platform-wide pool) or DEDICATED to one restaurant. This page lets the
 * restaurant choose its dispatch mode and manage its own dedicated roster.
 */
import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { DedicatedRidersClient } from './dedicated-riders-client';

export const metadata = { title: 'Admin · Dedicated Riders' };
export const dynamic = 'force-dynamic';

export default async function AdminRidersPage() {
  const restaurant = await requireRestaurant();

  const riders = await prisma.riderProfile.findMany({
    where: { riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    include: { user: { select: { name: true, phone: true } } },
    orderBy: [{ isOnline: 'desc' }, { totalDeliveries: 'desc' }]
  });

  const initialRiders = riders.map((r) => ({
    id: r.id,
    name: r.user?.name ?? null,
    phone: r.user?.phone ?? null,
    isOnline: r.isOnline,
    rating: r.rating,
    totalDeliveries: r.totalDeliveries,
    vehicleType: r.vehicleType ?? null,
    vehicleNumber: r.vehicleNumber ?? null,
    approvedAt: r.approvedAt
  }));

  const initialDispatch = {
    riderDispatchMode: (restaurant as any).riderDispatchMode as
      | 'FLEET_ONLY'
      | 'DEDICATED_ONLY'
      | 'DEDICATED_FIRST',
    fleetFallbackMinutes: (restaurant as any).fleetFallbackMinutes as number
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="display text-3xl font-semibold">Dedicated Riders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how your ready orders find a rider, and manage the riders dedicated to your restaurant.
        </p>
      </header>

      <DedicatedRidersClient
        initialRiders={JSON.parse(JSON.stringify(initialRiders))}
        initialDispatch={JSON.parse(JSON.stringify(initialDispatch))}
      />
    </div>
  );
}
