import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { adminFleetBranches, loadFleetSnapshot } from '@/server/live-fleet';

/**
 * GET /api/admin/live/riders
 *
 * The ~4 s poll behind /admin/live: the same branch-scoped snapshot as the
 * page's first paint, covering EVERY branch the admin manages (the whole group
 * for a group parent). The page's SSE stream can only follow one branch
 * channel, so without this poll riders working the other branches never moved
 * or appeared. Same access as the page: a restaurant ADMIN of the active
 * restaurant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  let restaurantId: string;
  try {
    restaurantId = (await requireRestaurant()).id;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { branches } = await adminFleetBranches(restaurantId);
  const snapshot = await loadFleetSnapshot({ branchIds: branches.map((b) => b.id) });
  return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}
