import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { ZonesClient } from './zones-client';
import { NoBranchNotice } from '../no-branch-notice';

export const metadata = { title: 'Admin · Delivery zones' };
export const dynamic = 'force-dynamic';

export default async function DeliveryZonesPage() {
  const restaurant = await requireRestaurant();
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (branches.length === 0) return <NoBranchNotice />;

  return (
    <ZonesClient
      restaurantId={restaurant.id}
      branches={branches.map((b) => ({ id: b.id, name: b.name, lat: b.latitude, lng: b.longitude }))}
    />
  );
}
