import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      customer: { select: { id: true, name: true, phone: true, email: true } },
      address: true,
      branch: { include: { restaurant: { select: { id: true, name: true, slug: true } } } },
      assignment: { include: { rider: { include: { user: { select: { id: true, name: true, phone: true } } } } } },
      payments: true,
      statusEvents: { orderBy: { createdAt: 'asc' } },
      refunds: true
    }
  });
  if (!order) return new Response('Not found', { status: 404 });
  return Response.json(order);
}
