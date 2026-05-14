import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { LivePlatformClient } from '@/components/live-tracking/live-platform-client';
import { Radio } from 'lucide-react';

export const metadata = { title: 'Admin · Live tracking' };
export const dynamic = 'force-dynamic';

export default async function AdminLivePage() {
  const restaurant = await requireRestaurant();

  // Restaurant-scoped: only riders working orders for one of *our* branches.
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id, isActive: true },
    select: { id: true, name: true, latitude: true, longitude: true }
  });
  const branchIds = branches.map((b) => b.id);

  const assignments = await prisma.riderAssignment.findMany({
    where: {
      status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] },
      order: { branchId: { in: branchIds } }
    },
    include: {
      rider: { include: { user: { select: { name: true } } } },
      order: {
        select: {
          id: true,
          code: true,
          customer: { select: { id: true, name: true } },
          address: { select: { id: true, latitude: true, longitude: true } },
          branch: { select: { id: true, latitude: true, longitude: true } }
        }
      }
    }
  });

  const initial = assignments
    .filter((a) => a.rider.currentLat != null && a.rider.currentLng != null)
    .map((a) => ({
      riderId: a.rider.id,
      lat: a.rider.currentLat!,
      lng: a.rider.currentLng!,
      orderId: a.orderId,
      at: new Date().toISOString(),
      name: a.rider.user?.name ?? 'Rider',
      status: a.status as 'PENDING' | 'ACCEPTED' | 'PICKED_UP'
    }));

  const branchPins = branches
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({ id: b.id, name: b.name, lat: b.latitude!, lng: b.longitude! }));

  const customers: { id: string; name?: string; lat: number; lng: number }[] = [];
  const destinations: { riderId: string; lat: number; lng: number }[] = [];
  for (const a of assignments) {
    const isPickedUp = a.status === 'PICKED_UP';
    const dropLat = a.order.address?.latitude;
    const dropLng = a.order.address?.longitude;
    const branchLat = a.order.branch.latitude;
    const branchLng = a.order.branch.longitude;
    const dest = isPickedUp && dropLat != null && dropLng != null
      ? { lat: dropLat, lng: dropLng }
      : branchLat != null && branchLng != null
        ? { lat: branchLat, lng: branchLng }
        : null;
    if (dest) destinations.push({ riderId: a.riderId, ...dest });
    if (dropLat != null && dropLng != null) {
      customers.push({
        id: a.order.id,
        name: a.order.customer?.name ?? 'Customer',
        lat: dropLat,
        lng: dropLng
      });
    }
  }

  // Pick the most active branch's channel — for multi-branch restaurants we
  // would ideally subscribe to *all* of them; for now use the first which is
  // how the previous implementation worked.
  const channel = branchIds[0] ? `branch:${branchIds[0]}:riders` : 'platform:riders';

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <Radio className="size-7 text-primary" /> Live tracking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every rider working an order for your restaurant. Click any pin for ETA, trail, and contact info.
        </p>
      </header>

      <LivePlatformClient
        initial={initial}
        branches={branchPins}
        customers={customers}
        destinations={destinations}
        isSuperAdmin={false}
        channel={channel}
        showBranchFilter={false}
      />
    </div>
  );
}
