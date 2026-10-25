/** GET /api/admin/reviews/recovery?status=OPEN|CONTACTED|RESOLVED — tickets + staff for assignment. */
import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listTickets, restaurantStaff } from '@/server/reviews/recovery-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['OPEN', 'CONTACTED', 'RESOLVED'] as const;

export async function GET(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const s = req.nextUrl.searchParams.get('status');
    if (s && !STATUSES.includes(s as (typeof STATUSES)[number])) {
      return Response.json({ error: 'Invalid status' }, { status: 400 });
    }
    const [tickets, staff] = await Promise.all([
      listTickets(restaurant.id, (s as (typeof STATUSES)[number]) || undefined),
      restaurantStaff(restaurant.id),
    ]);
    return Response.json({ tickets, staff });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
