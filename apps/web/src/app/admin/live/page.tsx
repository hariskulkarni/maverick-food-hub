import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { resolveGroupContext } from '@/server/group-scope';
import { LivePlatformClient } from '@/components/live-tracking/live-platform-client';
import { Radio } from 'lucide-react';

export const metadata = { title: 'Admin · Live tracking' };
export const dynamic = 'force-dynamic';

export default async function AdminLivePage() {
  const restaurant = await requireRestaurant();

  // Group-scoped: when the active restaurant is a group parent, span every
  // restaurant in the group (parent + children) — riders are shared across the
  // group so the parent must see riders working ANY group restaurant's orders.
  // Solo restaurants resolve to just themselves (unchanged).
  const group = await resolveGroupContext(restaurant.id);
  const groupRestaurantIds = group.restaurantIds.length
    ? group.restaurantIds
    : [restaurant.id];

  const branches = await prisma.branch.findMany({
    where: { restaurantId: { in: groupRestaurantIds }, isActive: true },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      // The branch's restaurant — so each pin can be labelled with the SOURCE
      // restaurant a rider is collecting from when the group spans many.
      restaurant: { select: { name: true } }
    }
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
    .map((b) => ({
      id: b.id,
      // In a real group, prefix the pickup pin with its restaurant so the parent
      // can tell which group restaurant each rider is collecting from.
      name: group.isGroup && b.restaurant?.name ? `${b.restaurant.name} — ${b.name}` : b.name,
      lat: b.latitude!,
      lng: b.longitude!
    }));

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
          {group.isGroup
            ? 'Every rider working an order across your group. Click any pin for ETA, trail, and contact info.'
            : 'Every rider working an order for your restaurant. Click any pin for ETA, trail, and contact info.'}
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
