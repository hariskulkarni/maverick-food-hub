/**
 * Cash-on-delivery bookkeeping for riders (P0-4).
 *
 * Lifecycle of a CodCollection row:
 *   - created PENDING_COLLECTION when a COD order gets a rider assignment
 *     (pool claim, batch accept, admin assign) — `ensureCodCollection`
 *   - moved to the new rider if the order is re-assigned before collection
 *   - COLLECTED with amountCollected = amountToCollect when the rider confirms
 *     delivery (`markCodCollectedOnDelivery`, called inside transitionOrder's
 *     DELIVERED transaction) — unless already settled digitally (collect-online
 *     marks it COLLECTED with ₹0 cash)
 *   - RECONCILED / WAIVED / MISMATCH by finance on /platform/cod
 *
 * All helpers take a transaction client and are idempotent.
 */
import { PaymentMethod, type Prisma } from '@prisma/client';

/** Statuses where the rider is still physically holding the cash. */
export const COD_CASH_HELD_STATUSES = ['COLLECTED', 'PARTIAL_COLLECTED', 'DEPOSIT_PENDING'] as const;

/**
 * Make sure a COD order has a CodCollection row pointing at `riderId`.
 * No-op for non-COD orders. If a row exists and is still PENDING_COLLECTION it
 * is re-pointed to the new rider (re-assignment); a row past collection is
 * never touched.
 */
export async function ensureCodCollection(
  tx: Prisma.TransactionClient,
  orderId: string,
  riderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      paymentMethod: true,
      total: true,
      payments: { where: { method: PaymentMethod.COD }, select: { amount: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!order || order.paymentMethod !== PaymentMethod.COD) return;
  const existing = await tx.codCollection.findUnique({ where: { orderId }, select: { id: true, status: true, riderId: true } });
  if (existing) {
    if (existing.status === 'PENDING_COLLECTION' && existing.riderId !== riderId) {
      await tx.codCollection.updateMany({
        where: { id: existing.id, status: 'PENDING_COLLECTION' },
        data: { riderId },
      });
    }
    return;
  }
  // The COD Payment row carries the final payable amount (after wallet /
  // loyalty / offers); fall back to the order total for legacy orders.
  const amount = order.payments[0]?.amount ?? order.total;
  await tx.codCollection.create({
    data: { orderId, riderId, amountToCollect: amount, status: 'PENDING_COLLECTION' },
  });
}

/** Rider handed over a COD order → the cash is now in their hands. */
export async function markCodCollectedOnDelivery(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const cod = await tx.codCollection.findUnique({ where: { orderId }, select: { id: true, status: true, amountToCollect: true } });
  if (!cod || cod.status !== 'PENDING_COLLECTION') return;
  await tx.codCollection.updateMany({
    where: { id: cod.id, status: 'PENDING_COLLECTION' },
    data: { status: 'COLLECTED', amountCollected: cod.amountToCollect, collectedAt: new Date() },
  });
}

/** Cash the rider is holding (collected, not yet reconciled/deposited). */
export async function codCashInHand(
  db: Pick<Prisma.TransactionClient, 'codCollection'>,
  riderId: string,
): Promise<number> {
  const agg = await db.codCollection.aggregate({
    where: { riderId, status: { in: [...COD_CASH_HELD_STATUSES] } },
    _sum: { amountCollected: true },
  });
  return Math.round(Number(agg._sum.amountCollected ?? 0) * 100) / 100;
}
