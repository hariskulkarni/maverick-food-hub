import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';
import { validateParentAssignment } from './_helpers';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

const Body = z.object({
  /** Parent restaurant id to nest under, or null to detach. */
  parentId: z.string().min(1).nullable(),
});

/** Set or clear a restaurant's parent (group membership). Super-admin only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;
  const { parentId } = Body.parse(await req.json());

  const check = await validateParentAssignment(id, parentId);
  if (!check.ok) return new Response(check.error ?? 'Invalid', { status: check.status ?? 400 });

  const before = await prisma.restaurant.findUnique({ where: { id }, select: { parentId: true } });
  const after = await prisma.restaurant.update({
    where: { id },
    data: { parentId },
    select: { id: true, parentId: true },
  });

  await audit('restaurant.settings.update', {
    actorId: session.user?.id,
    actorRole: session.user?.role,
    restaurantId: id,
    entityId: id,
    before,
    after: { parentId: after.parentId },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  });

  revalidateRestaurantSurfaces();
  return Response.json({ ok: true, parentId: after.parentId });
}
