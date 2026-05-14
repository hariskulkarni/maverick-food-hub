import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { OrdersClient, type OrderRow } from './orders-client';

export const metadata = { title: 'My orders' };

export default async function OrdersPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/orders');

  // Pull orders + their feedback (if any) + deliveredAt so the client can
  // pick the right CTA without a per-row round-trip. The Prisma client is
  // stale on feedback, hence the `as any` include.
  const orders = await prisma.order.findMany({
    where: { customerId: session.user.id },
    include: {
      items: true,
      assignment: { select: { deliveredAt: true } },
      ...({ feedback: true } as any)
    },
    orderBy: { placedAt: 'desc' }
  });

  const rows: OrderRow[] = orders.map((o: any) => {
    const delivered: Date | null =
      o.assignment?.deliveredAt ?? o.deliveredAt ?? (o.status === 'DELIVERED' ? o.updatedAt : null);
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      placedAt: (o.placedAt as Date).toISOString(),
      total: o.total.toString(),
      paymentMethod: o.paymentMethod,
      items: o.items.map((i: any) => ({ id: i.id, name: i.name, quantity: i.quantity })),
      deliveredAt: delivered ? new Date(delivered).toISOString() : null,
      feedback: o.feedback
        ? JSON.parse(JSON.stringify(o.feedback))
        : null
    };
  });

  return <OrdersClient orders={rows} />;
}
