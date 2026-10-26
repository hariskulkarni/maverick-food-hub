/**
 * Shared OrderFeedback create path, used by the signed-in order page
 * (POST /api/customer/orders/[id]/feedback) and by the tracked review link
 * (/feedback/<token>). Eligibility is checked by the caller via
 * canSubmitFeedback; this persists, audits, refreshes the rider rating and runs
 * the review follow-up (ReviewRequest stamp + low-rating recovery ticket).
 */
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import { recomputeRiderRatingForOrder } from '@/server/reviews/rider-rating';
import { FEEDBACK_WINDOW_MS } from '@/server/feedback';
import { onOrderFeedbackSaved } from '@/server/reviews/recovery';

export interface FeedbackInput {
  foodRating?: number;
  deliveryRating?: number;
  overallRating?: number;
  comment?: string;
  issueTags?: string[];
  imageUrl?: string;
  shareCommentWithRider?: boolean;
  sharePublicly?: boolean;
}

export async function createOrderFeedback(a: {
  orderId: string;
  orderCode: string;
  customerId: string;
  deliveredAt: Date;
  data: FeedbackInput;
  /** 'order_page' | 'review_link' — recorded in the audit row. */
  via: string;
}) {
  const { data } = a;
  const windowEndsAt = new Date(a.deliveredAt.getTime() + FEEDBACK_WINDOW_MS);

  // Restaurant opted out of auto-publish => hold as HIDDEN until an admin publishes (R3).
  const autoPublish = await prisma.order
    .findUnique({ where: { id: a.orderId }, select: { branch: { select: { restaurant: { select: { autoPublishReviews: true } } } } } })
    .then((o) => o?.branch?.restaurant?.autoPublishReviews !== false)
    .catch(() => true);

  const created = await (prisma as any).orderFeedback.create({
    data: {
      orderId: a.orderId,
      customerId: a.customerId,
      foodRating: data.foodRating ?? null,
      deliveryRating: data.deliveryRating ?? null,
      overallRating: data.overallRating ?? null,
      comment: data.comment ?? null,
      issueTags: data.issueTags ?? [],
      imageUrl: data.imageUrl ?? null,
      shareCommentWithRider: data.shareCommentWithRider ?? false,
      sharePublicly: data.sharePublicly ?? false,
      windowEndsAt,
      moderationStatus: autoPublish ? 'PUBLISHED' : 'HIDDEN'
    }
  });

  // Post-commit audit — failures must NOT bubble up.
  audit('order.feedback.submitted', {
    actorId: a.customerId,
    actorRole: 'CUSTOMER',
    entityType: 'OrderFeedback',
    entityId: created.id,
    before: null,
    after: {
      orderId: a.orderId,
      orderCode: a.orderCode,
      via: a.via,
      foodRating: created.foodRating,
      deliveryRating: created.deliveryRating,
      overallRating: created.overallRating,
      issueTags: created.issueTags,
      hasComment: !!created.comment,
      hasImage: !!created.imageUrl,
      shareCommentWithRider: created.shareCommentWithRider,
      sharePublicly: created.sharePublicly
    }
  }).catch((e) => log.error({ err: e }, 'feedback submit audit failed'));

  // Best-effort rider-rating refresh; never throws, never fails the write.
  if (created.deliveryRating != null) {
    await recomputeRiderRatingForOrder(a.orderId).catch((e) => log.error({ err: e }, 'rider rating refresh failed'));
  }

  const follow = await onOrderFeedbackSaved({
    orderId: a.orderId,
    customerId: a.customerId,
    overallRating: created.overallRating,
    foodRating: created.foodRating,
    deliveryRating: created.deliveryRating,
    comment: created.comment
  });

  return { feedback: created, ticketOpened: follow.ticketOpened };
}
