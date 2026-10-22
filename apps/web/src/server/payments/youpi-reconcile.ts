/**
 * Flavrly PG reconciliation — the single writer that can flip a Flavrly PG payment (and
 * therefore its order) to PAID.
 *
 * Money-safety contract: a payment is CAPTURED only when ALL hold:
 *   1. the gateway status call says CAPTURED,
 *   2. a non-empty UTR is present, and
 *   3. the gateway-reported amountPaise equals the expected amount exactly.
 * Anything else (status alone, amount mismatch, missing UTR, unknown, no
 * config) leaves the payment PENDING for the next sweep / a human.
 */

import { prisma } from '../db';
import { log } from '../log';
import { transitionOrder } from '../orders';
import { resolveYoupiConfig } from './youpi';
import { getYoupiStatus } from './youpi-api';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export interface YoupiReconcileOutcome {
  status: PaymentStatus;
  /** True when this call is what flipped the payment to CAPTURED. */
  captured: boolean;
  orderId: string;
  paymentId: string;
  /** True when we could not verify (no config / no ref) — retry later. */
  indeterminate?: boolean;
}

export async function reconcileYoupiPayment(paymentId: string): Promise<YoupiReconcileOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, status: true, branch: { select: { restaurantId: true } } } } },
  });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const base = { orderId: payment.orderId, paymentId: payment.id };

  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return { ...base, status: payment.status, captured: false };
  }

  const pending = { ...base, status: PaymentStatus.PENDING, captured: false };

  if (!payment.providerRef) return { ...pending, indeterminate: true };

  const cfg = await resolveYoupiConfig(payment.order.branch.restaurantId);
  if (!cfg) {
    log.warn({ paymentId, orderId: payment.orderId }, 'youpi.reconcile.no_config');
    return { ...pending, indeterminate: true };
  }

  const s = await getYoupiStatus(cfg, payment.providerRef);

  if (s.status === 'CAPTURED') {
    const expectedPaise = Math.round(Number(payment.amount) * 100);
    const utrOk = typeof s.utr === 'string' && s.utr.length > 0;
    const amountOk =
      typeof s.amountPaise === 'number' && Number.isInteger(s.amountPaise) && s.amountPaise === expectedPaise;
    if (!utrOk || !amountOk) {
      log.warn(
        {
          paymentId,
          orderId: payment.orderId,
          expectedPaise,
          gotPaise: s.amountPaise ?? null,
          hasUtr: utrOk,
        },
        'youpi.reconcile.amount_or_utr_mismatch',
      );
      return pending;
    }

    // An order must never hold two captured payments.
    const alreadyCaptured = await prisma.payment.findFirst({
      where: { orderId: payment.orderId, id: { not: payment.id }, status: PaymentStatus.CAPTURED },
      select: { id: true },
    });
    if (alreadyCaptured) {
      log.error(
        { paymentId, orderId: payment.orderId, otherPaymentId: alreadyCaptured.id },
        'youpi.reconcile.over_collection: order already has a captured payment; NOT capturing, refund required',
      );
      return { ...pending, indeterminate: true };
    }

    const updated = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED] },
      },
      data: { status: PaymentStatus.CAPTURED, providerRef: payment.providerRef },
    });
    const weCaptured = updated.count > 0;
    if (weCaptured) {
      try {
        await transitionOrder(payment.orderId, OrderStatus.RECEIVED, { note: 'Payment captured (Flavrly PG)' });
      } catch (e) {
        log.error({ err: (e as Error).message, orderId: payment.orderId }, 'youpi: order -> RECEIVED failed');
      }
      log.info({ paymentId, orderId: payment.orderId }, 'youpi payment captured');
    }
    return { ...base, status: PaymentStatus.CAPTURED, captured: weCaptured };
  }

  if (s.status === 'FAILED') {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
      data: { status: PaymentStatus.FAILED },
    });
    log.info({ paymentId, orderId: payment.orderId }, 'youpi payment failed');
    return { ...base, status: PaymentStatus.FAILED, captured: false };
  }

  return pending;
}
