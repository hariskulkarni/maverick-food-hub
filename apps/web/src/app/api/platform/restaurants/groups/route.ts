import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';

/**
 * Group tree for the super-admin restaurants area: every top-level restaurant
 * with its (single level of) children, plus a list of eligible parents
 * (top-level restaurants only) for the assignment selector.
 */
export async function GET(_req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;

  const tops = await prisma.restaurant.findMany({
    where: { parentId: null },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, slug: true, status: true,
      children: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, status: true },
      },
    },
  });

  const groups = tops
    .filter((t) => t.children.length > 0)
    .map((t) => ({
      id: t.id, name: t.name, slug: t.slug, status: t.status,
      children: t.children,
    }));

  // Eligible parents: top-level restaurants (can't pick a child as a parent).
  const eligibleParents = tops.map((t) => ({ id: t.id, name: t.name, slug: t.slug }));

  return Response.json({ groups, eligibleParents });
}
