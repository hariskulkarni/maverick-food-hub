import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { currentRestaurant } from '@/server/tenancy';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  // C12: the category must belong to a branch of the caller's restaurant. A
  // scoped deleteMany fails closed — a cross-tenant id simply matches nothing.
  const restaurant = await currentRestaurant();
  if (!restaurant) return Response.json({ error: 'No restaurant for this user.', reason: 'no_restaurant' }, { status: 404 });
  try {
    const res = await prisma.category.deleteMany({ where: { id, branch: { restaurantId: restaurant.id } } });
    if (res.count === 0) {
      return Response.json({ error: 'Category not found.', reason: 'not_found' }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: 'Category still has items or is referenced elsewhere — remove its items first.', reason: 'in_use' },
      { status: 409 }
    );
  }
}
