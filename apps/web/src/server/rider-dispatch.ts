/**
 * Dispatch helpers — turns the live order pool into a demand "heatmap".
 *
 * The rider app's Demand Map screen needs to know *where* the open orders are
 * clustered so riders can pre-position themselves. We approximate demand by
 * grouping the currently-poolable orders (READY + unassigned) by their pickup
 * branch and counting them — each branch with open orders becomes one demand
 * point, weighted by its open-order count.
 */
import { prisma } from './db';

/** Heat level for a demand point, derived purely from its open-order count. */
export type DemandIntensity = 'LOW' | 'MEDIUM' | 'HIGH';

/** A branch with open orders waiting to be claimed. */
export interface DemandPoint {
  name: string;
  lat: number;
  lng: number;
  count: number;
}

/**
 * Map an open-order count to a coarse intensity band.
 *   1–2  → LOW
 *   3–5  → MEDIUM
 *   6+   → HIGH
 */
export function intensityForCount(count: number): DemandIntensity {
  if (count >= 6) return 'HIGH';
  if (count >= 3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Aggregate the current poolable orders (status READY, no assignment) into
 * demand points grouped by pickup branch. Branches without geocoded
 * coordinates are skipped — they can't be plotted on a map. Result is sorted
 * by open-order count, busiest first.
 */
export async function getDemandPoints(): Promise<DemandPoint[]> {
  const orders = await prisma.order.findMany({
    where: { status: 'READY', assignment: null },
    include: { branch: { include: { restaurant: true } } },
  });

  // branchId → accumulated demand point
  const byBranch = new Map<string, DemandPoint>();

  for (const order of orders) {
    const branch = order.branch;
    if (!branch || branch.latitude == null || branch.longitude == null) continue;

    const existing = byBranch.get(branch.id);
    if (existing) {
      existing.count += 1;
    } else {
      byBranch.set(branch.id, {
        name: branch.restaurant?.name
          ? `${branch.restaurant.name} — ${branch.name}`
          : branch.name,
        lat: branch.latitude,
        lng: branch.longitude,
        count: 1,
      });
    }
  }

  return Array.from(byBranch.values()).sort((a, b) => b.count - a.count);
}
