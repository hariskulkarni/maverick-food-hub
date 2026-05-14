import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
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
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });
  return Response.json(r);
}
