import { notFound, redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { findFeedbackByOrder, FEEDBACK_WINDOW_MS } from '@/server/feedback';
import { resolveGoogleReviewUrl } from '@/server/reviews/acquisition';
import { OrderTrackerClient } from './tracker-client';
import { CUSTOMER_ORDER_INCLUDE } from '@/server/customer-order-view';

export const metadata = { title: 'Order' };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=/orders/${id}`);
  const o = await prisma.order.findUnique({
    where: { id },
    include: CUSTOMER_ORDER_INCLUDE
  });
  if (!o || o.customerId !== session.user.id) return notFound();

  // Hydrate the feedback summary so the tracker can render the right CTA
  // (give / edit / read-only) without an extra client-side fetch.
  const feedback = await findFeedbackByOrder(id);
  const delivered: Date | null =
    (o.assignment as any)?.deliveredAt ?? (o as any).deliveredAt ?? (o.status === 'DELIVERED' ? o.updatedAt : null);
  const windowEndsAt = delivered ? new Date(delivered.getTime() + FEEDBACK_WINDOW_MS) : null;
  // Google review link + tracked token (if a review ask exists) for the
  // post-delivery "Review us on Google" block — shown the same at every rating.
  // Resolved up front so the block appears when the live tracker flips to DELIVERED.
  // The customer view's branch select is explicit (no restaurantId), so look it up server-side.
  const [google, reviewRequest] = await Promise.all([
    (async (): Promise<{ url: string | null }> => {
      const b = await prisma.branch.findUnique({ where: { id: o.branch.id }, select: { restaurantId: true } });
      return b ? resolveGoogleReviewUrl(b.restaurantId) : { url: null };
    })().catch(() => ({ url: null })),
    prisma.reviewRequest.findUnique({ where: { orderId: id }, select: { token: true } }).catch(() => null)
  ]);

  return (
    <OrderTrackerClient
      order={JSON.parse(JSON.stringify(o))}
      existingFeedback={feedback ? JSON.parse(JSON.stringify(feedback)) : null}
      deliveredAt={delivered ? delivered.toISOString() : null}
      feedbackWindowEndsAt={windowEndsAt ? windowEndsAt.toISOString() : null}
      googleReviewUrl={google.url}
      reviewToken={reviewRequest?.token ?? null}
    />
  );
}
