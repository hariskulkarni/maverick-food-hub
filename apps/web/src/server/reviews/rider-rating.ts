/**
 * Rider rating loop: derive `RiderProfile.rating` from customer
 * `OrderFeedback.deliveryRating` so the rider-allocator's rating weight
 * reflects real feedback.
 *
 * Window: the average covers the rider's most recent RIDER_RATING_WINDOW (100)
 * rated deliveries (newest feedback first), so old history ages out and the
 * query stays bounded.
 *
 * Only PUBLISHED feedback counts: HIDDEN/FLAGGED rows are excluded.
 *
 * Both exports are best-effort: they never throw into the caller.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';

export const RIDER_RATING_WINDOW = 100;

export async function recomputeRiderRating(riderId: string): Promise<void> {
  try {
    const rows: { deliveryRating: number | null }[] = await (prisma as any).orderFeedback.findMany({
      where: {
        deliveryRating: { not: null },
        moderationStatus: 'PUBLISHED',
        order: { assignment: { riderId, status: 'DELIVERED' } }
      },
      orderBy: { createdAt: 'desc' },
      take: RIDER_RATING_WINDOW,
      select: { deliveryRating: true }
    });
    const ratings = rows.map((r) => r.deliveryRating).filter((n): n is number => typeof n === 'number');
    if (ratings.length === 0) return; // keep the existing/default rating
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    await prisma.riderProfile.update({ where: { id: riderId }, data: { rating: avg } });
  } catch (err) {
    log.error({ err, riderId }, 'rider rating recompute failed');
  }
}

/** Resolve the order's rider via RiderAssignment, then recompute. */
export async function recomputeRiderRatingForOrder(orderId: string): Promise<void> {
  try {
    const a = await prisma.riderAssignment.findUnique({ where: { orderId }, select: { riderId: true } });
    if (!a) return;
    await recomputeRiderRating(a.riderId);
  } catch (err) {
    log.error({ err, orderId }, 'rider rating recompute (by order) failed');
  }
}
