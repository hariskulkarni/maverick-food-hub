import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { brand } from '@/lib/brand';
import { notify } from '@/server/notifications';
import { sendWebPush } from '@/server/push/webpush';
import { scheduleReviewRequest } from '@/server/reviews/acquisition';

/**
 * One-time "how was your order?" nudge sent when an order becomes DELIVERED.
 * Channels: web push (if subscribed) + SMS. Idempotent via an atomic claim on
 * Order.feedbackRequestedAt. Best-effort: never throws (sits in the transition path).
 *
 * When the restaurant has Google review requests enabled, the SMS is replaced by
 * a delayed, tracked ask (ReviewRequest, sent by the review-requests sweep with
 * quiet hours, frequency cap and opt-out applied) so the customer is asked once.
 */
export async function requestFeedbackOnDelivered(a: {
  orderId: string;
  code: string;
  customerId: string;
  phone?: string | null;
  restaurantId?: string | null;
  feedbackRequestedAt: Date | null;
}): Promise<void> {
  try {
    if (a.feedbackRequestedAt) return;
    const existing = await prisma.orderFeedback.findUnique({ where: { orderId: a.orderId }, select: { id: true } });
    if (existing) return;
    // Atomic claim: only the caller that flips null -> now sends.
    const claim = await prisma.order.updateMany({
      where: { id: a.orderId, feedbackRequestedAt: null },
      data: { feedbackRequestedAt: new Date() }
    });
    if (claim.count !== 1) return;

    const url = `/orders/${a.orderId}`;
    let scheduled = false;
    if (a.restaurantId) {
      try {
        scheduled = await scheduleReviewRequest({
          orderId: a.orderId,
          restaurantId: a.restaurantId,
          customerId: a.customerId,
          deliveredAt: new Date()
        });
      } catch (e) {
        log.error({ err: (e as Error).message, orderId: a.orderId }, 'review request schedule failed');
      }
    }
    try {
      if ((await prisma.webPushSubscription.count({ where: { userId: a.customerId } })) > 0) {
        await sendWebPush(a.customerId, {
          title: 'How was your order?',
          body: `Order ${a.code}: tell us how it went.`,
          url,
          tag: `feedback-${a.orderId}`
        });
      }
    } catch (e) {
      log.error({ err: (e as Error).message, orderId: a.orderId }, 'feedback request push failed');
    }
    if (a.phone && !scheduled) {
      await notify
        .sms({
          to: a.phone,
          userId: a.customerId,
          template: 'order.feedback_request',
          restaurantId: a.restaurantId ?? undefined,
          body: `${brand.name}: How was order ${a.code}? Leave quick feedback: ${url}`
        })
        .catch((e) => log.error({ err: (e as Error).message, orderId: a.orderId }, 'feedback request sms failed'));
    }
  } catch (e) {
    log.error({ err: (e as Error).message, orderId: a.orderId }, 'feedback request failed');
  }
}
