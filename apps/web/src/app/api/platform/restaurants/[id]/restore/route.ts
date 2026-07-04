import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

/**
 * POST /api/platform/restaurants/[id]/restore — un-archive. Clears deletedAt.
 * Stays SUSPENDED so the super-admin reviews it, then clicks Reactivate to go
 * live again. (The slug stays its freed form; rename via Identity if reusing.)
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const r = await prisma.restaurant.update({ where: { id }, data: { deletedAt: null } });
  revalidateRestaurantSurfaces(r.slug);
  return Response.json({ ok: true, restaurant: { id: r.id, status: r.status } });
}
