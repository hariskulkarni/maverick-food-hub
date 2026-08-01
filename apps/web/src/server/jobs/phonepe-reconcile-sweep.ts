/**
 * PhonePe reconciliation sweep.
 *
 * The last line of defence for online payments. Webhooks get lost, tenants
 * misconfigure the dashboard, customers close the tab mid-UPI-collect, and
 * mercury occasionally returns the browser to a dead network. Any of those
 * leaves a PENDING Payment that PhonePe has long since decided about.
 *
 * This sweep asks PhonePe about every payment still in flight and applies the
 * answer through the same `reconcilePhonePePayment` path the webhook uses, so
 * there is exactly one place that can capture an order.
 *
 * It also does the one thing the reconciler deliberately will not: once a
 * checkout is provably dead (PhonePe still says PENDING but the PayPage expiry
 * has passed), it moves the order to PAYMENT_FAILED, releasing the signup-bonus
 * hold and restoring freebie stock.
 *
 * Run from /api/platform/jobs/phonepe-reconcile/run — every 5 minutes is a good
 * cadence (aligned with PhonePe's own webhook retry cadence).
 */

import { prisma } from '../db';
import { log } from '../log';
import {
  markOrderPaymentFailed,
  reconcilePhonePePayment,
  reconcilePhonePeRefund,
} from '../payments/reconcile';
import { PaymentStatus, RefundStatus } from '@prisma/client';

export interface SweepResult {
  paymentsScanned: number;
  captured: number;
  failed: number;
  stillPending: number;
  unreachable: number;
  ordersMarkedFailed: number;
  refundsScanned: number;
  refundsSettled: number;
}

/**
 * Only consider payments older than this. A payment created seconds ago is
 * still being paid — sweeping it would burn an API call to learn "PENDING".
 */
const MIN_AGE_MS = 90_000;

/**
 * And younger than this. Beyond a day PhonePe has certainly expired the order,
 * and a stale row is better handled by an operator than by a job that would
 * re-query it forever.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Grace period past the PayPage expiry before we call the order dead. */
const EXPIRY_GRACE_MS = 5 * 60_000;

/** Bounded per run so a backlog can't blow the request timeout. */
const BATCH = 100;

function expiryOf(providerData: unknown): number | null {
  if (typeof providerData !== 'object' || providerData === null) return null;
  const raw = (providerData as Record<string, unknown>)._expireAt;
  return typeof raw === 'number' && raw > 0 ? raw : null;
}

export async function runPhonePeReconcileSweep(): Promise<SweepResult> {
  const now = Date.now();
  const result: SweepResult = {
    paymentsScanned: 0,
    captured: 0,
    failed: 0,
    stillPending: 0,
    unreachable: 0,
    ordersMarkedFailed: 0,
    refundsScanned: 0,
    refundsSettled: 0,
  };

  // ── Payments ──────────────────────────────────────────────────────────────
  const pending = await prisma.payment.findMany({
    where: {
      providerName: 'phonepe',
      status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] },
      createdAt: { lt: new Date(now - MIN_AGE_MS), gt: new Date(now - MAX_AGE_MS) },
    },
    select: { id: true, orderId: true, providerData: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  for (const p of pending) {
    result.paymentsScanned += 1;
    try {
      const outcome = await reconcilePhonePePayment(p.id);
      if (outcome.status === PaymentStatus.CAPTURED) {
        result.captured += 1;
      } else if (outcome.status === PaymentStatus.FAILED) {
        result.failed += 1;
        // A terminal failure means the customer cannot complete this attempt.
        if (await markOrderPaymentFailed(p.orderId, 'PhonePe reported the payment failed')) {
          result.ordersMarkedFailed += 1;
        }
      } else if (outcome.indeterminate) {
        // Gateway unreachable — leave it alone, next run tries again.
        result.unreachable += 1;
      } else {
        result.stillPending += 1;
        // PhonePe still says PENDING, but the PayPage has expired: nobody can
        // complete it now, so release the order's held bonuses/stock.
        const expiry = expiryOf(p.providerData);
        if (expiry && now > expiry + EXPIRY_GRACE_MS) {
          if (await markOrderPaymentFailed(p.orderId, 'PhonePe checkout expired without payment')) {
            result.ordersMarkedFailed += 1;
          }
        }
      }
    } catch (e) {
      log.error({ err: (e as Error).message, paymentId: p.id }, 'phonepe sweep: payment reconcile threw');
    }
  }

  // ── Refunds ───────────────────────────────────────────────────────────────
  // Same problem, other direction: a refund we initiated but whose
  // pg.refund.completed never arrived would sit PENDING forever and never mark
  // the order REFUNDED.
  const refunds = await prisma.refund.findMany({
    where: {
      status: RefundStatus.PENDING,
      destination: 'ORIGINAL_PAYMENT',
      providerRef: { not: null },
      payment: { providerName: 'phonepe' },
      createdAt: { lt: new Date(now - MIN_AGE_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  for (const r of refunds) {
    result.refundsScanned += 1;
    try {
      const outcome = await reconcilePhonePeRefund(r.id);
      if (outcome.settled) result.refundsSettled += 1;
    } catch (e) {
      log.error({ err: (e as Error).message, refundId: r.id }, 'phonepe sweep: refund reconcile threw');
    }
  }

  if (result.paymentsScanned || result.refundsScanned) {
    log.info(result as unknown as Record<string, unknown>, 'phonepe reconcile sweep complete');
  }
  return result;
}
