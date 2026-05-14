import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

/**
 * GET /api/me/restaurants — list every restaurant the signed-in user is a member of.
 *
 * Combines two sources of truth:
 *   1. `RestaurantUser` rows — explicit per-restaurant ADMIN/KITCHEN memberships.
 *   2. `Restaurant.ownerUserId` — the primary owner from signup; not always
 *      mirrored into RestaurantUser, so we union it in here as ADMIN.
 *
 * Used by the per-restaurant staff login flow to detect "you're signed in
 * but not a member of this restaurant" before redirecting into /admin.
 */
export async function GET() {
  const s = await auth();
  if (!s?.user) return Response.json({ memberships: [] });

  const userId = s.user.id;

  const [memberships, owned] = await Promise.all([
    prisma.restaurantUser.findMany({
      where: { userId },
      include: { restaurant: { select: { id: true, slug: true, name: true } } }
    }),
    prisma.restaurant.findMany({
      where: { ownerUserId: userId },
      select: { id: true, slug: true, name: true }
    })
  ]);

  // De-duplicate by restaurantId — an owner may also have an explicit RestaurantUser row.
  const byId = new Map<string, { restaurantId: string; slug: string; name: string; role: string }>();
  for (const m of memberships) {
    byId.set(m.restaurant.id, {
      restaurantId: m.restaurant.id,
      slug: m.restaurant.slug,
      name: m.restaurant.name,
      role: m.role
    });
  }
  for (const r of owned) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { restaurantId: r.id, slug: r.slug, name: r.name, role: 'ADMIN' });
    }
  }

  return Response.json({ memberships: Array.from(byId.values()) });
}
