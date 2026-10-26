import { requireRestaurant } from '@/server/tenancy';
import { LivePlatformClient } from '@/components/live-tracking/live-platform-client';
import { adminFleetBranches, loadFleetSnapshot } from '@/server/live-fleet';
import { Radio } from 'lucide-react';

export const metadata = { title: 'Admin · Live tracking' };
export const dynamic = 'force-dynamic';

export default async function AdminLivePage() {
  const restaurant = await requireRestaurant();

  // Group-scoped: when the active restaurant is a group parent, span every
  // restaurant in the group (parent + children) — riders are shared across the
  // group so the parent must see riders working ANY group restaurant's orders.
  // Solo restaurants resolve to just themselves (unchanged).
  const group = await adminFleetBranches(restaurant.id);
  const branches = group.branches;
  const branchIds = branches.map((b) => b.id);

  // Riders working this restaurant's (or group's) orders, with real GPS-fix
  // times, "signal lost" and their current leg — the same derivation as the
  // platform map (server/live-fleet.ts). Assignments are scoped to these
  // branches, so other restaurants' orders never show here.
  const snapshot = await loadFleetSnapshot({ branchIds });

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

  // SSE can follow one branch channel (sub-second motion there); the 4 s poll
  // (/api/admin/live/riders) keeps riders on EVERY branch of the restaurant /
  // group current, adds riders as they take orders and removes them after.
  const channel = branchIds[0] ? `branch:${branchIds[0]}:riders` : 'platform:riders';

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
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
        initial={snapshot.riders}
        branches={branchPins}
        customers={snapshot.customers}
        waiting={snapshot.waiting}
        isSuperAdmin={false}
        channel={channel}
        showBranchFilter={false}
        pollUrl="/api/admin/live/riders"
      />
    </div>
  );
}
