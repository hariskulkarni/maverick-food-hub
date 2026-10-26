/**
 * Customer benefits an order consumes at placement (wallet, loyalty points, legacy coupon,
 * Offer-engine redemptions) — the atomic debit at checkout and the idempotent give-back on cancel.
 *
 * Debits are conditional single-statement updates (`balance >= amount`), so N concurrent checkouts
 * can never spend the same rupee twice: Postgres serialises the row update and the losers see
 * count 0 and abort their order transaction.
 *
 * Give-back runs inside transitionOrder's transaction when an order is cancelled (any CANCELLED*).
 * Wallet/points come back only when no money was captured for the order (captured orders go through
 * the refund flow, whose cap includes walletApplied — refunds.ts). Coupon/offer usage always comes
 * back on cancel, since the order never completed.
 */
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Note prefix of the wallet credit written by the cancel give-back (identifies it among REFUND rows). */
export const WALLET_RESTORE_NOTE = 'Wallet restored';

export class BenefitUnavailableError extends Error {}

export async function debitWalletForOrder(tx: Tx, userId: string, orderId: string, amount: number): Promise<void> {
  if (!(amount > 0)) return;
  const wallet = await tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
  const dec = new Prisma.Decimal(amount.toFixed(2));
  const r = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: dec } }, data: { balance: { decrement: dec } } });
  if (r.count !== 1) throw new BenefitUnavailableError('Wallet balance is lower than the amount you tried to apply');
  await tx.walletTransaction.create({ data: { walletId: wallet.id, orderId, type: 'ORDER_DEBIT', amount: dec } });
}

export async function redeemPointsForOrder(tx: Tx, userId: string, orderId: string, points: number): Promise<void> {
  if (!(points > 0)) return;
  const account = await tx.loyaltyAccount.upsert({ where: { userId }, update: {}, create: { userId } });
  const r = await tx.loyaltyAccount.updateMany({
    where: { id: account.id, pointsBalance: { gte: points } },
    data: { pointsBalance: { decrement: points }, lifetimeRedeem: { increment: points } },
  });
  if (r.count !== 1) throw new BenefitUnavailableError('Loyalty points balance is lower than the amount you tried to redeem');
  await tx.loyaltyTransaction.create({ data: { accountId: account.id, orderId, type: 'REDEEM', points: -points } });
}

/** True when the cancel give-back already credited this order's wallet amount. */
export async function walletRestoredForOrder(db: Pick<Tx, 'walletTransaction'>, orderId: string): Promise<boolean> {
  return !!(await db.walletTransaction.findFirst({
    where: { orderId, type: 'REFUND', note: { startsWith: WALLET_RESTORE_NOTE } },
    select: { id: true },
  }));
}

/**
 * Give back what a cancelled order consumed. Caller holds the order's status transition (the guarded
 * updateMany in transitionOrder), so this runs at most once per cancel; every step is additionally
 * idempotent on its own marker row so a replay never double-credits.
 */
export async function releaseOrderBenefitsOnCancel(
  tx: Tx,
  orderId: string,
): Promise<{ walletRestored: number; pointsRestored: number; couponReleased: boolean; offersReleased: number }> {
  const out = { walletRestored: 0, pointsRestored: 0, couponReleased: false, offersReleased: 0 };
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { customerId: true, walletApplied: true, loyaltyApplied: true } });
  if (!o) return out;

  // Coupon / offer usage: the order never completed, so the code is usable again.
  const coupon = await tx.couponRedemption.findUnique({ where: { orderId }, select: { id: true, couponId: true } });
  if (coupon) {
    const del = await tx.couponRedemption.deleteMany({ where: { id: coupon.id } });
    if (del.count === 1) {
      await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${coupon.couponId}`;
      out.couponReleased = true;
    }
  }
  const offers = await tx.offerRedemption.findMany({ where: { orderId }, select: { id: true, offerId: true } });
  for (const r of offers) {
    const del = await tx.offerRedemption.deleteMany({ where: { id: r.id } });
    if (del.count === 1) {
      await tx.$executeRaw`UPDATE "Offer" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${r.offerId}`;
      out.offersReleased++;
    }
  }

  // Wallet / points: only when no money was captured or bank-allocated (refund flow owns that case).
  const money = await tx.payment.count({ where: { orderId, status: { in: ['CAPTURED', 'REFUNDED'] }, method: { not: 'WALLET' } } });
  const allocated = await tx.pgAllocation.count({ where: { orderId, reversedAt: null } });
  if (money > 0 || allocated > 0) return out;

  const wallet = Number(o.walletApplied);
  if (wallet > 0 && !(await walletRestoredForOrder(tx, orderId))) {
    const amount = new Prisma.Decimal(o.walletApplied);
    const w = await tx.wallet.upsert({
      where: { userId: o.customerId },
      update: { balance: { increment: amount } },
      create: { userId: o.customerId, balance: amount },
    });
    await tx.walletTransaction.create({ data: { walletId: w.id, orderId, type: 'REFUND', amount, note: `${WALLET_RESTORE_NOTE}: order cancelled` } });
    // A ₹0 wallet-paid order's WALLET Payment no longer stands for money held.
    await tx.payment.updateMany({ where: { orderId, method: 'WALLET', status: 'CAPTURED' }, data: { status: 'REFUNDED' } });
    out.walletRestored = wallet;
  }
  const points = Math.round(Number(o.loyaltyApplied));
  if (points > 0 && !(await tx.loyaltyTransaction.findFirst({ where: { orderId, type: 'ADJUSTMENT', points: { gt: 0 } }, select: { id: true } }))) {
    const acc = await tx.loyaltyAccount.upsert({ where: { userId: o.customerId }, update: {}, create: { userId: o.customerId } });
    await tx.loyaltyAccount.update({ where: { id: acc.id }, data: { pointsBalance: { increment: points }, lifetimeRedeem: { decrement: points } } });
    await tx.loyaltyTransaction.create({ data: { accountId: acc.id, orderId, type: 'ADJUSTMENT', points, note: 'Points restored: order cancelled' } });
    out.pointsRestored = points;
  }
  return out;
}
