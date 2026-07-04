import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

/**
 * POST /api/platform/restaurants/[id]/archive — super-admin soft-delete.
 * Hides the restaurant from customers (status → SUSPENDED, which every public
 * listing/storefront already filters on), marks it archived (deletedAt), and
 * frees its slug so the name can be reused. Fully reversible via /restore.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const cur = await prisma.restaurant.findUnique({ where: { id }, select: { slug: true, deletedAt: true } });
  if (!cur) return new Response('Not found', { status: 404 });
  if (cur.deletedAt) return Response.json({ ok: true, alreadyArchived: true });
  const freedSlug = `${cur.slug}--del-${Date.now().toString(36)}`.slice(0, 190);
  const r = await prisma.restaurant.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'SUSPENDED', slug: freedSlug },
  });
  revalidateRestaurantSurfaces(cur.slug, r.slug);
  return Response.json({ ok: true, restaurant: { id: r.id, status: r.status } });
}
