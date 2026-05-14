import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

// DELETE — unassign one Restaurant from this brand (sets brandId=null).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; restaurantId: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id: brandId, restaurantId } = await params;

  const before: any = await (prisma as any).restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, brandId: true, name: true }
  });
  if (!before) return new Response('Restaurant not found', { status: 404 });
  if (before.brandId !== brandId) {
    return Response.json({ error: 'NOT_IN_BRAND', message: 'That restaurant is not assigned to this brand.' }, { status: 409 });
  }

  await (prisma as any).restaurant.update({ where: { id: restaurantId }, data: { brandId: null } });

  await audit('brand.unassign_restaurant', {
    actorId:   session?.user?.id,
    actorRole: session?.user?.role,
    entityId:  brandId,
    before:    { restaurantId, brandId: before.brandId },
    after:     { restaurantId, brandId: null },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  });

  return Response.json({ ok: true });
}
