import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { loadFleetSnapshot } from '@/server/live-fleet';
import { LivePlatformClient } from '@/components/live-tracking/live-platform-client';
import { Radio } from 'lucide-react';

export const metadata = { title: 'Platform · Live tracking' };
export const dynamic = 'force-dynamic';

export default async function PlatformLivePage() {
  await requireCapability('ops:read');

  // Same snapshot as the 4 s poll (GET /api/platform/riders/live), so the first
  // paint shows real GPS-fix times, "signal lost" riders and each rider's leg —
  // nothing is stamped "now".
  const [snapshot, branches] = await Promise.all([
    loadFleetSnapshot(),
    prisma.branch.findMany({
      where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
      select: { id: true, name: true, latitude: true, longitude: true }
    })
  ]);

  const branchPins = branches
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => ({ id: b.id, name: b.name, lat: b.latitude!, lng: b.longitude! }));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <Radio className="size-7 text-primary" /> Live tracking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every online rider's GPS, streaming in real time. Grey pins have lost signal for over 2 minutes; riders online without a GPS location are listed above the map. Test riders are labelled TEST and not counted. Click any pin for the active order, ETA, and trail.
        </p>
      </header>

      <LivePlatformClient
        initial={snapshot.riders}
        branches={branchPins}
        customers={snapshot.customers}
        waiting={snapshot.waiting}
        isSuperAdmin={true}
        channel="platform:riders"
        pollUrl="/api/platform/riders/live"
      />
    </div>
  );
}
