/**
 * Service recovery for low ratings.
 *
 * A rating at or below the restaurant's threshold opens ONE ticket per order
 * (ServiceRecoveryTicket.orderId is unique) and alerts the owner (email + SMS,
 * debounced per restaurant). This runs IN ADDITION to the Google review link,
 * which the customer sees at every rating — recovery never replaces or hides it.
 *
 * Goodwill gestures recorded on a ticket are unconditional: they must never be
 * offered in exchange for writing, changing or removing a review.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { notify } from '@/server/notifications';
import { isDebouncedNow, phoneRecipientsForRestaurant, recipientsForRestaurant } from '@/server/alerts';
import { SITE_URL, effectiveRating, loadAcquisitionConfig, needsRecovery } from './acquisition';

export const RECOVERY_ALERT_WINDOW_MIN = 30;

/** Owner alert, at most once per restaurant per window (AlertDebounce row). */
export async function alertOwnerOfTicket(t: { restaurantId: string; restaurantName: string; orderCode: string | null; rating: number }) {
  const key = { entityType: 'Restaurant', entityId: t.restaurantId, kind: 'review.recovery' };
  const existing = await prisma.alertDebounce.findUnique({ where: { entityType_entityId_kind: key } });
  if (existing && isDebouncedNow(existing.lastSentAt, new Date(), RECOVERY_ALERT_WINDOW_MIN)) return { sent: false, reason: 'debounced' as const };
  await prisma.alertDebounce.upsert({
    where: { entityType_entityId_kind: key },
    update: { lastSentAt: new Date() },
    create: { ...key, lastSentAt: new Date() },
  });
  const open = await prisma.serviceRecoveryTicket.count({ where: { restaurantId: t.restaurantId, status: 'OPEN' } });
  const link = `${SITE_URL}/admin/reviews/recovery`;
  const what = t.orderCode ? `order ${t.orderCode}` : 'a QR feedback';
  const sms = `${t.restaurantName}: ${what} was rated ${t.rating}/5. ${open} open service-recovery ticket(s): ${link}`;
  const [emails, phones] = await Promise.all([recipientsForRestaurant(t.restaurantId), phoneRecipientsForRestaurant(t.restaurantId)]);
  const subject = `[${t.restaurantName}] Low rating: ${what} (${t.rating}/5)`.replace(/[\r\n]+/g, ' ');
  const body = [
    `${what[0].toUpperCase()}${what.slice(1)} was rated ${t.rating}/5.`,
    `Open service-recovery tickets: ${open}`,
    '',
    `Reach out to the customer: ${link}`,
    '',
    'Any goodwill gesture must be unconditional. Never ask the customer to change or remove a review.',
  ].join('\n');
  for (const to of emails) {
    await notify.email({ to, subject, body, template: 'alert.review.recovery', restaurantId: t.restaurantId })
      .catch((e) => log.error({ err: (e as Error).message }, 'recovery alert email failed'));
  }
  for (const to of phones) {
    await notify.sms({ to, body: sms, template: 'alert.review.recovery', restaurantId: t.restaurantId })
      .catch((e) => log.error({ err: (e as Error).message }, 'recovery alert sms failed'));
  }
  return { sent: true as const };
}

/** Create the ticket if absent (idempotent per order) and alert the owner. Never throws. */
export async function openRecoveryTicket(t: {
  restaurantId: string;
  orderId: string | null;
  reviewRequestId?: string | null;
  customerId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  rating: number;
  comment?: string | null;
}): Promise<{ created: boolean; id?: string }> {
  try {
    if (t.orderId) {
      const existing = await prisma.serviceRecoveryTicket.findUnique({ where: { orderId: t.orderId }, select: { id: true } });
      if (existing) {
        // Keep the latest rating/comment visible to staff; status is theirs to manage.
        await prisma.serviceRecoveryTicket.update({ where: { id: existing.id }, data: { rating: t.rating, comment: t.comment ?? null } });
        return { created: false, id: existing.id };
      }
    }
    const ticket = await prisma.serviceRecoveryTicket.create({
      data: {
        restaurantId: t.restaurantId,
        orderId: t.orderId,
        reviewRequestId: t.reviewRequestId ?? null,
        customerId: t.customerId ?? null,
        contactName: t.contactName ?? null,
        contactPhone: t.contactPhone ?? null,
        rating: t.rating,
        comment: t.comment ?? null,
      },
      include: { restaurant: { select: { name: true } }, order: { select: { code: true } } },
    });
    await alertOwnerOfTicket({
      restaurantId: t.restaurantId,
      restaurantName: ticket.restaurant.name,
      orderCode: ticket.order?.code ?? null,
      rating: t.rating,
    }).catch((e) => log.error({ err: (e as Error).message }, 'recovery alert failed'));
    return { created: true, id: ticket.id };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { created: false };
    log.error({ err: (e as Error).message, orderId: t.orderId }, 'open recovery ticket failed');
    return { created: false };
  }
}

/**
 * Called after any OrderFeedback create/edit (order page or tracked link):
 * stamps the order's ReviewRequest as FEEDBACK and opens a recovery ticket for
 * low ratings. Best-effort, never throws.
 */
export async function onOrderFeedbackSaved(f: {
  orderId: string;
  customerId: string;
  overallRating?: number | null;
  foodRating?: number | null;
  deliveryRating?: number | null;
  comment?: string | null;
}): Promise<{ ticketOpened: boolean }> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: f.orderId },
      select: { branch: { select: { restaurantId: true } }, customer: { select: { name: true, phone: true } }, reviewRequest: { select: { id: true, feedbackAt: true } } },
    });
    if (!order) return { ticketOpened: false };
    const restaurantId = order.branch.restaurantId;
    if (order.reviewRequest && !order.reviewRequest.feedbackAt) {
      await prisma.reviewRequest.update({
        where: { id: order.reviewRequest.id },
        data: { feedbackAt: new Date(), status: 'FEEDBACK', reminderDueAt: null },
      });
    }
    const rating = effectiveRating(f);
    const cfg = await loadAcquisitionConfig(restaurantId);
    if (!needsRecovery(rating, cfg.lowRatingThreshold)) return { ticketOpened: false };
    const r = await openRecoveryTicket({
      restaurantId,
      orderId: f.orderId,
      reviewRequestId: order.reviewRequest?.id ?? null,
      customerId: f.customerId,
      contactName: order.customer?.name ?? null,
      contactPhone: order.customer?.phone ?? null,
      rating: rating!,
      comment: f.comment ?? null,
    });
    return { ticketOpened: r.created || !!r.id };
  } catch (e) {
    log.error({ err: (e as Error).message, orderId: f.orderId }, 'feedback follow-up failed');
    return { ticketOpened: false };
  }
}

/** Minutes the delivery ran past its ETA (null when unknown / on time). */
export function minutesLate(o: { estimatedDeliveryAt: Date | null; deliveredAt: Date | null }): number | null {
  if (!o.estimatedDeliveryAt || !o.deliveredAt) return null;
  const late = Math.round((o.deliveredAt.getTime() - o.estimatedDeliveryAt.getTime()) / 60_000);
  return late > 0 ? late : null;
}
