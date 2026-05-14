/**
 * POST /api/customer/reorder/[orderId]
 * Builds a cart payload the customer-side cart page can hydrate from.
 * Verifies the requesting user owns the order.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      branch: { select: { slug: true } }
    }
  });
  if (!order) return new Response('Not found', { status: 404 });
  if (order.customerId !== session.user.id) return new Response('Forbidden', { status: 403 });

  const items = order.items
    .filter((i) => !!i.menuItemId)
    .map((i) => ({
      menuItemId: i.menuItemId as string,
      quantity: i.quantity,
      name: i.name,
      price: Number(i.unitPrice)
    }));

  return Response.json({ items, branchSlug: order.branch.slug });
}
