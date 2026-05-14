import { notFound, redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { findFeedbackByOrder, FEEDBACK_WINDOW_MS } from '@/server/feedback';
import { OrderTrackerClient } from './tracker-client';

export const metadata = { title: 'Order' };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/orders/${id}`);
  const o = await prisma.order.findUnique({
    where: { id },
    include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } }, address: true, branch: true, payments: true, assignment: { include: { rider: { include: { user: true } } } } }
  });
  if (!o || o.customerId !== session.user.id) return notFound();

  // Hydrate the feedback summary so the tracker can render the right CTA
  // (give / edit / read-only) without an extra client-side fetch.
  const feedback = await findFeedbackByOrder(id);
  const delivered: Date | null =
    (o.assignment as any)?.deliveredAt ?? (o as any).deliveredAt ?? (o.status === 'DELIVERED' ? o.updatedAt : null);
  const windowEndsAt = delivered ? new Date(delivered.getTime() + FEEDBACK_WINDOW_MS) : null;

  return (
    <OrderTrackerClient
      order={JSON.parse(JSON.stringify(o))}
      existingFeedback={feedback ? JSON.parse(JSON.stringify(feedback)) : null}
      deliveredAt={delivered ? delivered.toISOString() : null}
      feedbackWindowEndsAt={windowEndsAt ? windowEndsAt.toISOString() : null}
    />
  );
}
