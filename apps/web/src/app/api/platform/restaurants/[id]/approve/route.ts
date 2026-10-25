import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';
import { clientIp } from '@/server/http/client-ip';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = await auth();
  const { id } = await params;
  const before = await prisma.restaurant.findUnique({ where: { id }, select: { status: true, approvedAt: true } });
  const r = await prisma.restaurant.update({
    where: { id },
    data: { status: 'ACTIVE', approvedAt: new Date(), rejectedReason: null }
  });
  await audit('restaurant.approve', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: id,
    entityId: id,
    before,
    after: { status: r.status, approvedAt: r.approvedAt },
    ipAddress: clientIp(req.headers)
  });
  revalidateRestaurantSurfaces(r.slug);
  return Response.json(r);
}
