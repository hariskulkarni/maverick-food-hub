import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listForRestaurant } from '@/server/integrations';

/**
 * Integration status for the caller's active restaurant.
 *
 * `?restaurantId=` is honoured for SUPER_ADMIN only (see
 * requireManagedRestaurant) so the platform owner can open any tenant's
 * gateway panel. Tenant admins stay scoped to their own memberships.
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('restaurantId');
  const restaurant = await requireManagedRestaurant(target);
  const list = await listForRestaurant(restaurant.id);
  return Response.json(list);
}
