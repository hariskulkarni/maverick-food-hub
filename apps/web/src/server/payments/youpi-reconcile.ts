/**
 * Flavrly PG status probe -> evidence -> reconcile engine.
 *
 * Policy (contract D2/D3): a gateway SUCCESS is an OBSERVATION, never a capture. This module
 * records it as GATEWAY_STATUS evidence (attempt -> OBSERVED) and then asks the engine to
 * allocate a matching bank credit; only `allocateBankCredit()` in ../pg/reconcile-engine.ts
 * may set Payment.status = CAPTURED and release the order (via the ORDER_RELEASE outbox).
 *
 * - FAILED/EXPIRED from the gateway marks Payment + attempt FAILED only if the attempt was
 *   never OBSERVED and has no allocation; otherwise it opens an exception and stays PENDING.
 * - Legacy youpi Payment rows without a PgPaymentAttempt are never auto-captured: they get a
 *   STALE_PENDING exception for an operator and stay PENDING.
 */

import { PaymentStatus, PgAttemptState, PgEvidenceSource, PgExceptionKind } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { resolveYoupiConfig } from './youpi';
import { getYoupiStatus } from './youpi-api';
import { openException } from '../pg/exceptions';
import { appendFinancialEvent } from '../pg/ledger';
import { recordObservation, tryAllocateForAttempt } from '../pg/reconcile-engine';

export interface YoupiReconcileOutcome {
  status: PaymentStatus;
  /** True when this call is what flipped the payment to CAPTURED. */
  captured: boolean;
  orderId: string;
  paymentId: string;
  /** True when we could not verify (no config / no ref / needs operator) — retry later. */
  indeterminate?: boolean;
}

/** States from which a gateway FAILED may still close the attempt. */
const FAILABLE: PgAttemptState[] = [PgAttemptState.CREATED, PgAttemptState.AWAITING_PAYMENT, PgAttemptState.CREATE_UNKNOWN];
const DEAD: PgAttemptState[] = [PgAttemptState.FAILED, PgAttemptState.EXPIRED, PgAttemptState.CANCELLED];

export async function reconcileYoupiPayment(paymentId: string): Promise<YoupiReconcileOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: { select: { id: true, status: true, branch: { select: { restaurantId: true } } } },
      pgAttempt: true,
    },
  });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const base = { orderId: payment.orderId, paymentId: payment.id };

  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return { ...base, status: payment.status, captured: false };
  }

  const pending = { ...base, status: PaymentStatus.PENDING, captured: false };
  const restaurantId = payment.order.branch.restaurantId;
  const attempt = payment.pgAttempt;

  if (!attempt) {
    // Pre-ledger payment: no receiving-account binding and no attempt identity, so it can
    // never be matched to bank evidence automatically. Hand it to an operator.
    await openException(prisma, {
      kind: PgExceptionKind.STALE_PENDING,
      dedupeKey: `STALE_PENDING:legacy:${payment.id}`,
      restaurantId,
      orderId: payment.orderId,
      detail: { reason: 'legacy_youpi_payment_without_attempt', paymentId: payment.id },
    });
    log.warn({ paymentId, orderId: payment.orderId }, 'youpi.reconcile.legacy_no_attempt');
    return { ...pending, indeterminate: true };
  }

  const gatewayRef = attempt.gatewayPaymentId ?? payment.providerRef;
  if (!gatewayRef) return { ...pending, indeterminate: true };

  const cfg = await resolveYoupiConfig(restaurantId);
  if (!cfg) {
    log.warn({ paymentId, orderId: payment.orderId }, 'youpi.reconcile.no_config');
    return { ...pending, indeterminate: true };
  }

  const s = await getYoupiStatus(cfg, gatewayRef);
  await prisma.pgPaymentAttempt.update({
    where: { id: attempt.id },
    data: { lastGatewayStatus: s.status, lastStatusAt: new Date() },
  });

  if (s.status === 'CAPTURED') {
    await recordObservation({
      attemptId: attempt.id,
      source: PgEvidenceSource.GATEWAY_STATUS,
      utr: s.utr ?? null,
      amountPaise: typeof s.amountPaise === 'number' ? s.amountPaise : null,
      // Read with the merchant key over TLS from the bound gateway: authenticated source.
      authenticated: true,
      verificationMethod: 'merchant_key_status_read',
      eventAt: new Date(),
      dedupeKey: `GATEWAY_STATUS:${attempt.id}:SUCCESS`,
      meta: { gatewayStatus: 'SUCCESS', hasUtr: !!s.utr },
    });
    const r = await tryAllocateForAttempt(attempt.id);
    if (r.outcome === 'CAPTURED') {
      log.info({ paymentId, orderId: payment.orderId }, 'youpi payment captured (bank-verified)');
      return { ...base, status: PaymentStatus.CAPTURED, captured: true };
    }
    const fresh = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    if (fresh?.status === PaymentStatus.CAPTURED) return { ...base, status: PaymentStatus.CAPTURED, captured: false };
    log.info({ paymentId, orderId: payment.orderId, outcome: r.outcome }, 'youpi.reconcile.observed_awaiting_bank');
    return pending;
  }

  if (s.status === 'FAILED') {
    const closed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PgPaymentAttempt" WHERE id = ${attempt.id} FOR UPDATE`;
      const a = await tx.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      const allocations = await tx.pgAllocation.count({ where: { attemptId: a.id } });
      const closable = FAILABLE.includes(a.state) || DEAD.includes(a.state);
      if (!closable || a.observedUtr || allocations > 0) {
        await openException(tx, {
          kind: PgExceptionKind.STALE_PENDING,
          dedupeKey: `STALE_PENDING:failed_after_observed:${a.id}`,
          restaurantId: a.restaurantId,
          receivingAccountId: a.receivingAccountId,
          attemptId: a.id,
          orderId: a.orderId,
          detail: { reason: 'gateway_failed_after_observation_or_allocation', state: a.state, allocations },
        });
        return false;
      }
      if (FAILABLE.includes(a.state)) {
        await tx.pgPaymentAttempt.update({ where: { id: a.id }, data: { state: PgAttemptState.FAILED } });
      }
      await tx.payment.updateMany({
        where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
        data: { status: PaymentStatus.FAILED },
      });
      await appendFinancialEvent(tx, {
        kind: 'ATTEMPT_FAILED',
        restaurantId: a.restaurantId,
        attemptId: a.id,
        orderId: a.orderId,
        dedupeKey: `ATTEMPT_FAILED:${a.id}`,
        data: { from: a.state, source: 'GATEWAY_STATUS' },
      });
      return true;
    });
    if (!closed) {
      log.warn({ paymentId, orderId: payment.orderId }, 'youpi.reconcile.failed_after_observed');
      return { ...pending, indeterminate: true };
    }
    log.info({ paymentId, orderId: payment.orderId }, 'youpi payment failed');
    return { ...base, status: PaymentStatus.FAILED, captured: false };
  }

  return pending;
}
