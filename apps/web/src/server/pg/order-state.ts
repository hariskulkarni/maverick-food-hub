/**
 * Flavrly PG order-state helpers shared by attempts, the reconcile engine and the order machine.
 *
 * A "PG prepay order" is one placeOrder created in PAYMENT_PENDING (only the Flavrly PG rail does
 * that), recognisable by its PAYMENT_PENDING OrderStatusEvent. Policy for such orders while unpaid:
 *   - PAYMENT_FAILED is NOT terminal: the customer may retry, and an accepted late payment may still
 *     release the order, so coupon/wallet/loyalty/signup-bonus/freebie stay held;
 *   - a terminal cancel of a never-captured order releases them (orders.ts transitionOrder);
 *   - reviving PAYMENT_FAILED -> PAYMENT_PENDING happens only inside the transaction that opens the
 *     next payment (createPgAttempt) or captures an accepted late payment (allocateBankCredit).
 */
import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';

type Tx = Prisma.TransactionClient;

export const PG_PAYABLE_ORDER: readonly OrderStatus[] = [OrderStatus.PAYMENT_PENDING, OrderStatus.PAYMENT_FAILED];

/**
 * True when placeOrder created this order in PAYMENT_PENDING — every prepaid online order (Flavrly PG,
 * PhonePe, Razorpay). Such an order holds its benefits on PAYMENT_FAILED (retry possible) and releases
 * them on a terminal cancel. Never throws.
 */
export async function isPgPrepayOrder(orderId: string, db: Tx | typeof prisma = prisma): Promise<boolean> {
  try {
    const ev = await db.orderStatusEvent.findFirst({ where: { orderId, status: OrderStatus.PAYMENT_PENDING }, select: { id: true } });
    return !!ev;
  } catch {
    return false;
  }
}

/**
 * Names the first order benefit that was already given back (so the order total no longer matches
 * what the customer is entitled to), or null. Orders failed before the hold policy existed may have
 * had their signup bonus / freebie released on PAYMENT_FAILED.
 */
export async function releasedBenefit(tx: Tx, orderId: string): Promise<string | null> {
  const o = await tx.order.findUnique({
    where: { id: orderId },
    select: { freebieRuleId: true, signupBonusApplied: true, walletApplied: true, loyaltyApplied: true, items: { where: { isFreebie: true }, select: { id: true } } },
  });
  if (!o) return 'order';
  if (o.items.length > 0 && !o.freebieRuleId) return 'free gift';
  if (Number(o.signupBonusApplied) > 0) {
    const restored = await (tx as unknown as { signupBonusLedger: { findFirst: (a: unknown) => Promise<unknown> } }).signupBonusLedger.findFirst({
      where: { orderId, kind: 'RESTORE' },
    });
    if (restored) return 'signup bonus';
  }
  if (Number(o.walletApplied) > 0 && (await tx.walletTransaction.findFirst({ where: { orderId, type: 'REFUND' }, select: { id: true } }))) return 'wallet';
  if (Number(o.loyaltyApplied) > 0 && (await tx.loyaltyTransaction.findFirst({ where: { orderId, type: 'ADJUSTMENT', points: { gt: 0 } }, select: { id: true } }))) {
    return 'loyalty points';
  }
  return null;
}

export class OrderReviveError extends Error {}

/**
 * PAYMENT_FAILED -> PAYMENT_PENDING inside the caller's transaction (caller holds the Order row lock).
 * Refuses when a benefit was already released. Returns true when this call revived the order.
 */
export async function revivePaymentFailedOrder(tx: Tx, orderId: string, note: string, actorId?: string | null): Promise<boolean> {
  const released = await releasedBenefit(tx, orderId);
  if (released) {
    throw new OrderReviveError(`The ${released} on this order was already given back when the payment failed. Please place a new order.`);
  }
  const r = await tx.order.updateMany({ where: { id: orderId, status: OrderStatus.PAYMENT_FAILED }, data: { status: OrderStatus.PAYMENT_PENDING } });
  if (r.count !== 1) return false;
  await tx.orderStatusEvent.create({ data: { orderId, status: OrderStatus.PAYMENT_PENDING, note, actorId: actorId ?? null } });
  return true;
}

const CANCEL: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
];
export const isCancelStatus = (s: OrderStatus) => CANCEL.includes(s);

/**
 * Runs inside transitionOrder's transaction when an order moves to a CANCELLED* status.
 *
 * P1-7: attempts that could still be paid (CREATED / CREATE_UNKNOWN / AWAITING_PAYMENT) become
 * CANCELLED and their Payment FAILED, so nobody is invited to pay a cancelled order. Gateway evidence
 * still lands on a CANCELLED attempt and a later credit is allocated as LATE_PAYMENT (refund).
 * OBSERVED / REVIEW_REQUIRED / CAPTURED attempts are left for reconciliation.
 *
 * Wallet / loyalty / coupon / offer give-back on cancel now applies to every rail and lives in
 * order-benefits.ts (releaseOrderBenefitsOnCancel), called by transitionOrder next to this.
 */
export async function settlePgOrderOnCancel(tx: Tx, orderId: string, prev: OrderStatus): Promise<{ attemptsCancelled: number }> {
  const out = { attemptsCancelled: 0 };
  const open = await tx.pgPaymentAttempt.findMany({
    where: { orderId, state: { in: ['CREATED', 'CREATE_UNKNOWN', 'AWAITING_PAYMENT'] } },
    select: { id: true, paymentId: true, state: true, restaurantId: true },
  });
  if (open.length > 0) {
    const { appendFinancialEvent } = await import('./ledger');
    for (const a of open) {
      const moved = await tx.pgPaymentAttempt.updateMany({ where: { id: a.id, state: a.state }, data: { state: 'CANCELLED' } });
      if (moved.count !== 1) continue;
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } },
        data: { status: 'FAILED', errorMessage: 'Order cancelled before payment was confirmed.' },
      });
      await appendFinancialEvent(tx, {
        kind: 'ATTEMPT_CANCELLED',
        restaurantId: a.restaurantId,
        attemptId: a.id,
        orderId,
        dedupeKey: `ATTEMPT_CANCELLED:${a.id}`,
        data: { from: a.state, reason: 'order_cancelled' },
      });
      out.attemptsCancelled++;
    }
  }

  void prev;
  return out;
}
