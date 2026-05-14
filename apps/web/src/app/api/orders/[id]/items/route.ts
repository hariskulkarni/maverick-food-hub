import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.customerId !== session.user.id) return new Response('Not found', { status: 404 });
  return Response.json(order.items.map((i) => ({
    id: (i.menuItemId ? i.menuItemId : 'combo:' + i.comboId) as string,
    refId: (i.menuItemId ?? i.comboId) as string,
    kind: i.menuItemId ? 'item' : 'combo',
    name: i.name,
    quantity: i.quantity,
    unitPrice: Number(i.unitPrice)
  })));
}
