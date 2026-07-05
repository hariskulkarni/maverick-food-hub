import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { LivePlatformClient } from '@/components/live-tracking/live-platform-client';
import { Radio } from 'lucide-react';

export const metadata = { title: 'Platform · Live tracking' };
export const dynamic = 'force-dynamic';

export default async function PlatformLivePage() {
  await requireCapability('ops:read');

  const [riders, branches] = await Promise.all([
    prisma.riderProfile.findMany({
      where: { isOnline: true, currentLat: { not: null }, currentLng: { not: null } },
      include: {
        user: { select: { name: true } },
        assignments: {
          where: { status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } },
          take: 1,
          orderBy: { assignedAt: 'desc' },
          include: {
            order: {
              select: {
                id: true,
                code: true,
                addressId: true,
                address: { select: { id: true, latitude: true, longitude: true, line1: true } },
                customer: { select: { id: true, name: true } },
                branch: { select: { id: true, latitude: true, longitude: true } }
              }
            }
          }
        }
      }
    }),
    prisma.branch.findMany({
      where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
      select: { id: true, name: true, latitude: true, longitude: true }
    })
  ]);

  const initial = riders.map((r) => {
    const a = r.assignments[0];
    return {
      riderId: r.id,
      lat: r.currentLat!,
      lng: r.currentLng!,
      at: new Date().toISOString(),
      name: r.user?.name ?? 'Rider',
      status: (a?.status as 'PENDING' | 'ACCEPTED' | 'PICKED_UP' | undefined) ?? ('IDLE' as const),
      orderId: a?.order.id
    };
  });

  const branchPins = branches
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({ id: b.id, name: b.name, lat: b.latitude!, lng: b.longitude! }));

  // For each rider with an active order, derive their destination pin (branch
  // if still picking up, drop address once PICKED_UP). Stat strip uses this
  // to compute avg ETA live.
  const customers: { id: string; name?: string; lat: number; lng: number }[] = [];
  const destinations: { riderId: string; lat: number; lng: number }[] = [];
  for (const r of riders) {
    const a = r.assignments[0];
    if (!a) continue;
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
    if (dest) destinations.push({ riderId: r.id, ...dest });
    if (dropLat != null && dropLng != null) {
      customers.push({
        id: a.order.id,
        name: a.order.customer?.name ?? 'Customer',
        lat: dropLat,
        lng: dropLng
      });
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <Radio className="size-7 text-primary" /> Live tracking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every rider's GPS, streaming in real time. Click any pin to drill into the active order, ETA, and trail.
        </p>
      </header>

      <LivePlatformClient
        initial={initial}
        branches={branchPins}
        customers={customers}
        destinations={destinations}
        isSuperAdmin={true}
        channel="platform:riders"
        pollUrl="/api/platform/riders/live"
      />
    </div>
  );
}
