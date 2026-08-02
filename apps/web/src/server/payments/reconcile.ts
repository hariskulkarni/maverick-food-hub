/**
 * Payment reconciliation — the single writer for online payment outcomes.
 *
 * Four callers converge here, and they must not disagree:
 *   • the PhonePe webhook              (fast path, but only a hint — see below)
 *   • the customer return route        (browser came back from the PayPage)
 *   • the client status poll           (return page, while state is PENDING)
 *   • the sweeper job                  (webhook lost, browser never came back)
 *
 * Two rules make that safe:
 *
 *  1. **The gateway is always asked.** PhonePe authenticates webhooks with a
 *     static `SHA256(user:pass)` header, which is replayable by anyone who has
 *     ever seen one. So a webhook never directly flips a Payment; it triggers a
 *     server-to-server Order Status call, and *that* answer is applied. This is
 *     also PhonePe's own recommendation in the troubleshooting guide.
 *
 *  2. **Capture is one-way and idempotent.** A Payment already CAPTURED or
 *     REFUNDED is never rewritten, so a late PENDING/FAILED delivery cannot
 *     un-capture a paid order.
 *
 * Order-status policy on failure: we mark the *Payment* FAILED immediately, but
 * only move the *Order* to PAYMENT_FAILED once the checkout can no longer be
 * retried (expired or explicitly terminal). `transitionOrder(PAYMENT_FAILED)`
 * releases the signup-bonus hold and restores freebie stock — irreversible
 * bookkeeping we must not run on a failure the customer is about to retry past.
 */

import { prisma } from '../db';
import { log } from '../log';
import { maybeAutoAccept, transitionOrder } from '../orders';
import { resolvePhonePeConfig } from './phonepe';
import { getOrderStatus, getRefundStatus, type OrderStatusResult } from './phonepe-api';
import {
  paymentStatusFromPhonePe,
  refundStatusFromPhonePe,
  phonePeErrorMessage,
  toPhonePeState,
} from './phonepe-events';
import { OrderStatus, PaymentStatus, RefundStatus, type Payment } from '@prisma/client';

export interface ReconcileOutcome {
  /** Payment status after reconciliation. */
  status: PaymentStatus;
  /** True when this call is what flipped the payment to CAPTURED. */
  captured: boolean;
  /** Customer-safe reason when the payment failed. */
  error?: string;
  /** True when we could not reach the gateway — caller should retry later. */
  indeterminate?: boolean;
  orderId: string;
  paymentId: string;
}

/** Find the Payment row a PhonePe merchantOrderId belongs to. */
export async function findPhonePePayment(merchantOrderId: string): Promise<Payment | null> {
  return prisma.payment.findFirst({
    where: { providerRef: merchantOrderId, providerName: 'phonepe' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Ask PhonePe for the truth about one payment and persist the result.
 *
 * `statusOverride` lets the sweeper reuse a status response it already fetched;
 * everything else passes nothing and we make the call.
 */
export async function reconcilePhonePePayment(
  paymentId: string,
  opts: { statusOverride?: OrderStatusResult } = {},
): Promise<ReconcileOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, status: true, branch: { select: { restaurantId: true } } } } },
  });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const base = { orderId: payment.orderId, paymentId: payment.id };

  // Terminal already — nothing to do. Guards against a late webhook rewriting a
  // captured payment, and makes every caller safely re-runnable.
  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return { ...base, status: payment.status, captured: false };
  }

  const merchantOrderId = payment.providerRef;
  if (!merchantOrderId) {
    return { ...base, status: payment.status, captured: false, indeterminate: true };
  }

  let status: OrderStatusResult;
  if (opts.statusOverride) {
    status = opts.statusOverride;
  } else {
    const cfg = await resolvePhonePeConfig(payment.order.branch.restaurantId);
    if (!cfg) {
      log.error({ paymentId, orderId: payment.orderId }, 'phonepe reconcile: no credentials for restaurant');
      return { ...base, status: payment.status, captured: false, indeterminate: true };
    }
    try {
      status = await getOrderStatus(cfg, merchantOrderId);
    } catch (e) {
      // Network/5xx — explicitly NOT a payment failure. Leave it PENDING.
      log.warn({ err: (e as Error).message, paymentId, merchantOrderId }, 'phonepe status lookup failed');
      return { ...base, status: payment.status, captured: false, indeterminate: true };
    }
  }

  const state = toPhonePeState(status.state);
  const mapped = paymentStatusFromPhonePe(state);
  const attempt = (status.paymentDetails ?? []).find((d) => toPhonePeState(d.state) === state) ?? undefined;

  // ── Captured ─────────────────────────────────────────────────────────────
  if (mapped === 'CAPTURED') {
    // `providerRef` deliberately keeps the merchantOrderId rather than being
    // overwritten with the transaction id (as the Razorpay path does): PhonePe
    // refunds are addressed by the original merchantOrderId, so losing it here
    // would strand the refund path.
    const updated = await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED] } },
      data: {
        status: PaymentStatus.CAPTURED,
        errorMessage: null,
        providerData: {
          ...(typeof payment.providerData === 'object' && payment.providerData ? (payment.providerData as object) : {}),
          _capturedAt: new Date().toISOString(),
          _transactionId: attempt?.transactionId ?? null,
          _paymentMode: attempt?.paymentMode ?? null,
          _rail: (attempt?.rail as object) ?? null,
          _instrument: (attempt?.instrument as object) ?? null,
          _feeAmount: status.feeAmount ?? null,
          _statusResponse: status.raw as object,
        } as any,
      },
    });

    const weCaptured = updated.count > 0;
    if (weCaptured) {
      // A retry that succeeds after an earlier failure needs the order pulled
      // back out of PAYMENT_FAILED before it can be accepted.
      if (payment.order.status === OrderStatus.PAYMENT_FAILED || payment.order.status === OrderStatus.PAYMENT_PENDING) {
        await transitionOrder(payment.orderId, OrderStatus.RECEIVED, { note: 'Payment captured (PhonePe)' }).catch((e) =>
          log.error({ err: (e as Error).message, orderId: payment.orderId }, 'phonepe: order → RECEIVED failed'),
        );
      }
      await maybeAutoAccept(payment.orderId, payment.order.branch.restaurantId).catch((e) =>
        log.error({ err: (e as Error).message, orderId: payment.orderId }, 'phonepe: auto-accept failed'),
      );
      await settleCodCollection(payment.orderId, Number(payment.amount), attempt?.paymentMode).catch((e) =>
        log.error({ err: (e as Error).message, orderId: payment.orderId }, 'phonepe: COD settle failed'),
      );
      log.info({ paymentId, orderId: payment.orderId, mode: attempt?.paymentMode }, 'phonepe payment captured');
    }
    return { ...base, status: PaymentStatus.CAPTURED, captured: weCaptured };
  }

  // ── Failed ───────────────────────────────────────────────────────────────
  if (mapped === 'FAILED') {
    const message = phonePeErrorMessage(
      status.errorCode ?? attempt?.errorCode,
      status.detailedErrorCode ?? attempt?.detailedErrorCode,
    );
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
      data: {
        status: PaymentStatus.FAILED,
        errorMessage: message,
        providerData: {
          ...(typeof payment.providerData === 'object' && payment.providerData ? (payment.providerData as object) : {}),
          _failedAt: new Date().toISOString(),
          _errorCode: status.errorCode ?? attempt?.errorCode ?? null,
          _detailedErrorCode: status.detailedErrorCode ?? attempt?.detailedErrorCode ?? null,
          _statusResponse: status.raw as object,
        } as any,
      },
    });
    log.info({ paymentId, orderId: payment.orderId, code: status.detailedErrorCode }, 'phonepe payment failed');
    return { ...base, status: PaymentStatus.FAILED, captured: false, error: message };
  }

  // ── Still pending ────────────────────────────────────────────────────────
  return { ...base, status: PaymentStatus.PENDING, captured: false };
}

/**
 * Close out a cash-on-delivery record that was paid digitally instead.
 *
 * When a rider collects a COD order through PhonePe at the door, the money
 * never enters the rider's hands — so the CodCollection must not keep counting
 * toward their cash-in-hand. We mark it COLLECTED and stamp the note, but stop
 * short of RECONCILED: reconciliation is a finance action, and pretending it
 * already happened would hide the payment from the deposit workflow.
 *
 * No-op for ordinary online orders, which have no CodCollection row.
 */
async function settleCodCollection(orderId: string, amount: number, paymentMode?: string | null): Promise<void> {
  const cod = await prisma.codCollection.findUnique({
    where: { orderId },
    select: { id: true, status: true, notes: true },
  });
  if (!cod) return;
  if (cod.status !== 'PENDING_COLLECTION') return; // already handled

  await prisma.codCollection.update({
    where: { id: cod.id },
    data: {
      status: 'COLLECTED',
      // Zero cash: the rider is carrying nothing for this order.
      amountCollected: 0 as unknown as never,
      collectedAt: new Date(),
      notes: [cod.notes, `Paid digitally via PhonePe${paymentMode ? ` (${paymentMode})` : ''} — ₹${amount.toFixed(2)}, no cash collected.`]
        .filter(Boolean)
        .join(' '),
    },
  });
  log.info({ orderId, amount }, 'COD collection settled digitally');
}

/**
 * Ask PhonePe for the truth about one refund and persist the result.
 *
 * Same contract as the payment path: the webhook only tells us to look, the
 * Refund Status API decides. A refund that settles fully marks the underlying
 * Payment REFUNDED and walks the order to REFUNDED.
 */
export async function reconcilePhonePeRefund(
  refundRowId: string,
  opts: { statusOverride?: { state: string; errorCode?: string; detailedErrorCode?: string; raw?: unknown } } = {},
): Promise<{ status: RefundStatus; settled: boolean }> {
  const refund = await prisma.refund.findUnique({
    where: { id: refundRowId },
    include: {
      payment: { select: { id: true, status: true, amount: true } },
      order: { select: { id: true, status: true, total: true, branch: { select: { restaurantId: true } } } },
    },
  });
  if (!refund) throw new Error(`Refund ${refundRowId} not found`);

  // Terminal already.
  if (refund.status === RefundStatus.COMPLETED || refund.status === RefundStatus.FAILED) {
    return { status: refund.status, settled: refund.status === RefundStatus.COMPLETED };
  }
  if (!refund.providerRef) return { status: refund.status, settled: false };

  let state: string;
  let errorCode: string | undefined;
  let detailedErrorCode: string | undefined;
  let raw: unknown;

  if (opts.statusOverride) {
    ({ state, errorCode, detailedErrorCode, raw } = opts.statusOverride);
  } else {
    const cfg = await resolvePhonePeConfig(refund.order.branch.restaurantId);
    if (!cfg) return { status: refund.status, settled: false };
    try {
      const res = await getRefundStatus(cfg, refund.providerRef);
      state = res.state;
      errorCode = res.errorCode;
      detailedErrorCode = res.detailedErrorCode;
      raw = res.raw;
    } catch (e) {
      log.warn({ err: (e as Error).message, refundId: refundRowId }, 'phonepe refund status lookup failed');
      return { status: refund.status, settled: false };
    }
  }

  const mapped = refundStatusFromPhonePe(toPhonePeState(state));
  if (!mapped || mapped === 'PENDING') return { status: RefundStatus.PENDING, settled: false };

  const nextStatus = mapped === 'COMPLETED' ? RefundStatus.COMPLETED : RefundStatus.FAILED;
  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status: nextStatus,
      providerData: {
        ...(typeof refund.providerData === 'object' && refund.providerData ? (refund.providerData as object) : {}),
        _settledAt: new Date().toISOString(),
        _gatewayState: state,
        _errorCode: detailedErrorCode ?? errorCode ?? null,
        _statusResponse: (raw as object) ?? null,
      } as any,
    },
  });

  if (nextStatus === RefundStatus.FAILED) {
    log.warn({ refundId: refund.id, code: detailedErrorCode ?? errorCode }, 'phonepe refund failed');
    return { status: nextStatus, settled: false };
  }

  // Settled. Mark the payment REFUNDED once cumulative refunds cover the order.
  const allRefunds = await prisma.refund.findMany({
    where: { orderId: refund.orderId, status: RefundStatus.COMPLETED },
    select: { amount: true },
  });
  const refunded = allRefunds.reduce((s, r) => s + Number(r.amount), 0);
  const full = refunded >= Number(refund.order.total) - 0.005;

  if (full && refund.payment) {
    await prisma.payment
      .update({ where: { id: refund.payment.id }, data: { status: PaymentStatus.REFUNDED } })
      .catch(() => {});
  }
  await transitionOrder(refund.orderId, full ? OrderStatus.REFUNDED : OrderStatus.REFUND_INITIATED, {
    note: 'PhonePe refund settled',
  }).catch((e) => log.error({ err: (e as Error).message, orderId: refund.orderId }, 'phonepe: refund status advance failed'));

  log.info({ refundId: refund.id, orderId: refund.orderId, full }, 'phonepe refund settled');
  return { status: RefundStatus.COMPLETED, settled: true };
}

/**
 * Move an order to PAYMENT_FAILED once its checkout is genuinely dead.
 *
 * Split out from `reconcilePhonePePayment` on purpose: this transition releases
 * the signup-bonus hold and restores freebie stock, so it must only fire when
 * the customer can no longer complete this attempt — i.e. from the sweeper,
 * after the PayPage has expired.
 */
export async function markOrderPaymentFailed(orderId: string, note: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, payments: { select: { status: true } } },
  });
  if (!order) return false;
  if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) return false;
  if (order.status !== OrderStatus.RECEIVED && order.status !== OrderStatus.PAYMENT_PENDING) return false;
  try {
    await transitionOrder(orderId, OrderStatus.PAYMENT_FAILED, { note });
    return true;
  } catch (e) {
    log.error({ err: (e as Error).message, orderId }, 'phonepe: order → PAYMENT_FAILED failed');
    return false;
  }
}
