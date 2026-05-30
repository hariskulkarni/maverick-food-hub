import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAnyAdminApi } from '@/server/api-auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAnyAdminApi();
  if (gate instanceof Response) return gate;
  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: true, items: true, address: true, assignment: { include: { rider: { include: { user: true } } } } }
  });
  if (!o) return Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 });
  return Response.json(o);
}
