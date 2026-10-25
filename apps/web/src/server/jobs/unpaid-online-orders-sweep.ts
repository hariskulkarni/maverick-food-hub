/**
 * Unpaid online (PhonePe / Razorpay) orders that nobody else advances.
 *
 * Online orders start PAYMENT_PENDING and hold the customer's wallet/points/coupon/offer/bonus/freebie.
 * PhonePe's own sweep fails orders whose PayPage expired; Razorpay has no expiry signal at all, and an
 * order whose gateway session never opened has no Payment to sweep. This job closes both gaps:
 *
 *  1. PAYMENT_PENDING, nothing captured, no payment session opened in the last ORPHAN window and no
 *     status change in it  -> PAYMENT_FAILED (customer may still "Pay now"; benefits stay held).
 *  2. PAYMENT_FAILED, nothing captured, quiet for UNPAID_CANCEL -> CANCELLED_BY_ADMIN, which releases
 *     every held benefit through transitionOrder.
 *
 * Flavrly PG orders (youpi payment or attempt) are excluded — sweepUnpaidPgOrders owns them.
 * Run from /api/platform/jobs/phonepe-reconcile/run (every 5 minutes).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { markOrderPaymentFailed } from '../payments/reconcile';

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const ONLINE_ORPHAN_MS = envNumber('ONLINE_UNPAID_FAIL_MINUTES', 30) * 60_000;
export const ONLINE_UNPAID_CANCEL_MS = envNumber('ONLINE_UNPAID_CANCEL_HOURS', 24) * 3_600_000;

async function quietOnlineOrders(status: 'PAYMENT_PENDING' | 'PAYMENT_FAILED', cutoff: Date, limit: number): Promise<string[]> {
  const at = Prisma.sql`(${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM "Order" o
    WHERE o.status = ${status}::"OrderStatus"
      AND o."paymentMethod" IN ('RAZORPAY', 'PHONEPE')
      AND o."createdAt" < ${at}
      AND NOT EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e."createdAt" >= ${at})
      AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id
                      AND (p.status IN ('CAPTURED', 'REFUNDED') OR p."providerName" = 'youpi' OR p."createdAt" >= ${at}))
      AND NOT EXISTS (SELECT 1 FROM "PgPaymentAttempt" a WHERE a."orderId" = o.id)
    ORDER BY o."createdAt" ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

export async function sweepUnpaidOnlineOrders(opts: { now?: Date; limit?: number } = {}): Promise<{ failed: number; cancelled: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 100;
  const out = { failed: 0, cancelled: 0 };
  for (const id of await quietOnlineOrders('PAYMENT_PENDING', new Date(now.getTime() - ONLINE_ORPHAN_MS), limit)) {
    if (await markOrderPaymentFailed(id, 'Online payment not completed in time')) out.failed++;
  }
  const { transitionOrder } = await import('../orders');
  for (const id of await quietOnlineOrders('PAYMENT_FAILED', new Date(now.getTime() - ONLINE_UNPAID_CANCEL_MS), limit)) {
    try {
      await transitionOrder(id, 'CANCELLED_BY_ADMIN', { note: 'Unpaid online order closed automatically' });
      out.cancelled++;
    } catch (e) {
      log.warn({ orderId: id, err: (e as Error).message }, 'online.unpaid_cancel_failed');
    }
  }
  if (out.failed || out.cancelled) log.info(out, 'unpaid online orders sweep');
  return out;
}
