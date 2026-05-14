/**
 * DELETE /api/admin/dedicated-riders/[id]
 *
 * Un-dedicates a rider from this restaurant — sets riderType back to FLEET
 * and clears dedicatedRestaurantId. The rider returns to the platform-wide
 * pool. Tenant-gated: 404 if the rider isn't dedicated to THIS restaurant.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { auth } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();
  const { id } = await params;

  // Tenant gate: the rider must currently be dedicated to this restaurant.
  const profile = await prisma.riderProfile.findFirst({
    where: { id, riderType: 'DEDICATED', dedicatedRestaurantId: restaurant.id },
    select: { id: true }
  });
  if (!profile) return new Response('Not found', { status: 404 });

  await prisma.riderProfile.update({
    where: { id },
    data: { riderType: 'FLEET', dedicatedRestaurantId: null }
  });

  return Response.json({ ok: true });
}
