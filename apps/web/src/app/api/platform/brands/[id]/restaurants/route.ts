import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

const Body = z.object({
  restaurantIds: z.array(z.string()).min(1),
  force:         z.boolean().optional().default(false)
});

// POST — assign one or more Restaurants to this brand. Refuses to silently
// re-parent: if any incoming restaurant already has a different brandId, the
// caller must pass `force: true` to confirm the move.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id: brandId } = await params;

  const data = Body.parse(await req.json());

  const brand = await (prisma as any).brand.findUnique({ where: { id: brandId }, select: { id: true } });
  if (!brand) return new Response('Brand not found', { status: 404 });

  const current: any[] = await (prisma as any).restaurant.findMany({
    where: { id: { in: data.restaurantIds } },
    select: { id: true, brandId: true, name: true }
  });

  // Refuse silent re-parenting unless force=true
  if (!data.force) {
    const conflict = current.filter((r) => r.brandId && r.brandId !== brandId);
    if (conflict.length > 0) {
      return Response.json(
        {
          error: 'ALREADY_ASSIGNED',
          message: 'Some restaurants are already in a different brand. Pass force=true to move them.',
          conflicts: conflict.map((c) => ({ id: c.id, name: c.name, brandId: c.brandId }))
        },
        { status: 409 }
      );
    }
  }

  const before = current.map((r) => ({ id: r.id, brandId: r.brandId }));

  await (prisma as any).restaurant.updateMany({
    where: { id: { in: data.restaurantIds } },
    data:  { brandId }
  });

  const after = before.map((b) => ({ id: b.id, brandId }));

  await audit('brand.assign_restaurants', {
    actorId:   session?.user?.id,
    actorRole: session?.user?.role,
    entityId:  brandId,
    before:    { restaurants: before },
    after:     { restaurants: after },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  });

  return Response.json({ ok: true, assigned: data.restaurantIds.length });
}
