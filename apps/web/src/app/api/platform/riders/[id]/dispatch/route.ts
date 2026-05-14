/**
 * PATCH /api/platform/riders/:id/dispatch
 * Body: { riderType: 'FLEET' | 'DEDICATED', dedicatedRestaurantId?: string }
 *
 * Switches a rider between the shared fleet pool and a restaurant-dedicated
 * assignment. When DEDICATED, `dedicatedRestaurantId` is required and must
 * resolve to a real restaurant; when FLEET, it is nulled out. Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  riderType: z.enum(['FLEET', 'DEDICATED']),
  dedicatedRestaurantId: z.string().optional().nullable()
}).refine(
  (v) => v.riderType === 'FLEET' || (!!v.dedicatedRestaurantId && v.dedicatedRestaurantId.trim().length > 0),
  { message: 'dedicatedRestaurantId is required when riderType is DEDICATED', path: ['dedicatedRestaurantId'] }
);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = Body.parse(await req.json());

  const before = await prisma.riderProfile.findUnique({
    where: { id },
    select: { id: true, riderType: true, dedicatedRestaurantId: true }
  });
  if (!before) return new Response('Rider not found', { status: 404 });

  let dedicatedRestaurantId: string | null = null;
  if (data.riderType === 'DEDICATED') {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: data.dedicatedRestaurantId! },
      select: { id: true }
    });
    if (!restaurant) return new Response('Restaurant not found', { status: 404 });
    dedicatedRestaurantId = restaurant.id;
  }

  const after = await prisma.riderProfile.update({
    where: { id },
    data: { riderType: data.riderType, dedicatedRestaurantId }
  });

  await audit('rider.dispatch.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderProfile',
    entityId: id,
    before: { riderType: before.riderType, dedicatedRestaurantId: before.dedicatedRestaurantId },
    after: { riderType: after.riderType, dedicatedRestaurantId: after.dedicatedRestaurantId },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({
    id: after.id,
    riderType: after.riderType,
    dedicatedRestaurantId: after.dedicatedRestaurantId
  });
}
