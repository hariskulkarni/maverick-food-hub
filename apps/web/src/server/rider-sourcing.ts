/**
 * Rider sourcing — the two-rider-type dispatch engine.
 *
 * A restaurant's `riderDispatchMode` decides which riders may take its READY
 * orders:
 *   - FLEET_ONLY      → only FLEET riders.
 *   - DEDICATED_ONLY  → only that restaurant's DEDICATED riders.
 *   - DEDICATED_FIRST → that restaurant's DEDICATED riders immediately; FLEET
 *                       riders also see it once the order has been READY for
 *                       ≥ `fleetFallbackMinutes` (measured from `readyAt`).
 *
 * This module is the single source of truth for those rules. The pool listing,
 * the claim endpoint, and the push-notification fan-out all funnel through it
 * so the policy can never drift between read-paths and write-paths.
 */
import { prisma } from './db';
import { RiderType, RiderDispatchMode } from '@prisma/client';

/**
 * The minimal rider identity the dispatch rules need. Callers typically
 * `select` exactly these three columns off `RiderProfile`.
 */
export interface RiderSourcingProfile {
  id: string;
  riderType: RiderType;
  dedicatedRestaurantId: string | null;
}

/**
 * The minimal order shape the dispatch rules need: the order's `readyAt`
 * timestamp plus its restaurant's dispatch policy, reached via
 * `branch.restaurant`. Orders passed in must have that relation included.
 */
export interface OrderWithRestaurant {
  readyAt: Date | null;
  branch: {
    restaurant: {
      id: string;
      riderDispatchMode: RiderDispatchMode;
      fleetFallbackMinutes: number;
    };
  };
}

/**
 * Has this order been READY long enough that the fleet fallback has kicked in?
 * Used only for DEDICATED_FIRST. If `readyAt` is somehow null we treat the
 * fallback as NOT yet open (conservative — keeps it dedicated-only until the
 * restaurant actually marks it ready).
 */
function fleetFallbackElapsed(
  readyAt: Date | null,
  fleetFallbackMinutes: number,
  now: Date
): boolean {
  if (!readyAt) return false;
  const elapsedMs = now.getTime() - readyAt.getTime();
  return elapsedMs >= fleetFallbackMinutes * 60_000;
}

/**
 * Core predicate: may this rider claim/see this single order right now?
 *
 * `order` must include `branch.restaurant` (with `id`, `riderDispatchMode`,
 * `fleetFallbackMinutes`). `now` is injectable for deterministic testing and
 * so a batch (`filterOrdersForRider`) evaluates every order against one clock.
 */
export function riderCanClaimOrder(
  profile: RiderSourcingProfile,
  order: OrderWithRestaurant,
  now: Date = new Date()
): boolean {
  const restaurant = order.branch.restaurant;
  const isDedicated = profile.riderType === RiderType.DEDICATED;
  // A DEDICATED rider is "this restaurant's" only when their
  // dedicatedRestaurantId matches the order's restaurant.
  const isDedicatedToThisRestaurant =
    isDedicated && profile.dedicatedRestaurantId === restaurant.id;

  switch (restaurant.riderDispatchMode) {
    case RiderDispatchMode.FLEET_ONLY:
      // Only fleet riders. Dedicated riders never touch fleet-only orders,
      // even if they happen to be dedicated to this same restaurant.
      return profile.riderType === RiderType.FLEET;

    case RiderDispatchMode.DEDICATED_ONLY:
      // Only this restaurant's dedicated riders.
      return isDedicatedToThisRestaurant;

    case RiderDispatchMode.DEDICATED_FIRST:
      // This restaurant's dedicated riders may claim immediately.
      if (isDedicatedToThisRestaurant) return true;
      // Fleet riders join in once the fallback window has elapsed.
      if (profile.riderType === RiderType.FLEET) {
        return fleetFallbackElapsed(
          order.readyAt,
          restaurant.fleetFallbackMinutes,
          now
        );
      }
      // Dedicated riders of *other* restaurants never see this order.
      return false;

    default:
      // Unknown mode → fail closed.
      return false;
  }
}

/**
 * Filter a batch of candidate orders down to the subset this rider is
 * eligible for. Every order is evaluated against a single shared `now` so a
 * DEDICATED_FIRST order can't be in/out depending on millisecond drift mid-loop.
 *
 * `orders` must each have `branch.restaurant` and `readyAt` included.
 */
export function filterOrdersForRider<T extends OrderWithRestaurant>(
  profile: RiderSourcingProfile,
  orders: T[]
): T[] {
  const now = new Date();
  return orders.filter((order) => riderCanClaimOrder(profile, order, now));
}

/**
 * Which online, push-registered riders should be pinged when a brand-new
 * order lands in the pool?
 *
 *   - FLEET_ONLY      → all online FLEET riders.
 *   - DEDICATED_ONLY  → this restaurant's online DEDICATED riders.
 *   - DEDICATED_FIRST → this restaurant's online DEDICATED riders only. Fleet
 *                       riders are intentionally NOT pushed at order-creation
 *                       time; they discover the order later via pool polling
 *                       once `fleetFallbackMinutes` has elapsed.
 *
 * Returns just the push tokens (`expoPushToken` guaranteed non-null) so the
 * caller can fan out without re-filtering. Best-effort: callers treat a thrown
 * error as "no one to notify" rather than failing the order.
 */
export async function targetRidersForNewOrder(
  orderId: string
): Promise<{ expoPushToken: string }[]> {
  // Load the order with just enough of the restaurant to know the policy.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      branch: {
        select: {
          restaurant: {
            select: { id: true, riderDispatchMode: true },
          },
        },
      },
    },
  });
  if (!order) return [];

  const restaurant = order.branch.restaurant;

  // Base filter: online riders with a usable push token.
  const onlineWithToken = {
    isOnline: true,
    expoPushToken: { not: null },
  } as const;

  let where;
  switch (restaurant.riderDispatchMode) {
    case RiderDispatchMode.FLEET_ONLY:
      where = { ...onlineWithToken, riderType: RiderType.FLEET };
      break;

    case RiderDispatchMode.DEDICATED_ONLY:
    case RiderDispatchMode.DEDICATED_FIRST:
      // Both modes ping this restaurant's dedicated riders at creation time.
      // (For DEDICATED_FIRST, fleet riders pick it up later via polling.)
      where = {
        ...onlineWithToken,
        riderType: RiderType.DEDICATED,
        dedicatedRestaurantId: restaurant.id,
      };
      break;

    default:
      return [];
  }

  const riders = await prisma.riderProfile.findMany({
    where,
    select: { expoPushToken: true },
  });

  // `expoPushToken: { not: null }` already guarantees this, but narrow the
  // type explicitly so the return type is honest.
  return riders.filter(
    (r): r is { expoPushToken: string } => r.expoPushToken !== null
  );
}
