/**
 * Flavrly PG payment attempts (contract D8): one attempt = one gateway session.
 *
 *   attemptKey = `${orderId}-${attemptId}` (sent upstream as orderId; also the idempotency key).
 *
 * createPgAttempt():
 *   1. resolve the merchant binding for NEW sessions (fail closed),
 *   2. in ONE transaction (receiving-account row locked): refuse if the order is paid or has an
 *      unresolved/live attempt (an unexpired AWAITING_PAYMENT with the same amount is returned
 *      instead), reserve limits, create Payment(PENDING) + PgPaymentAttempt(CREATED),
 *   3. THEN call the gateway:
 *        created + private readback matches  -> AWAITING_PAYMENT, checkout URL returned
 *        readback mismatch                   -> REVIEW_REQUIRED + RECEIVER_MISMATCH exception, no URL
 *        definitive 4xx                      -> FAILED, limit released
 *        timeout / network / 5xx / unclear   -> CREATE_UNKNOWN + exception, limit kept
 * resolveUnknownAttempt(): probes the gateway by gatewayPaymentId or attemptKey and settles a
 *   CREATED/CREATE_UNKNOWN attempt to AWAITING_PAYMENT / REVIEW_REQUIRED / FAILED / EXPIRED.
 *
 * Gateway SUCCESS is never treated as capture here (D2). Secrets never leave the server.
 */

import { openException as openReconException } from './exceptions';
import crypto from 'node:crypto';
import { Prisma, type PaymentMethod, type PgAttemptState, type PgExceptionKind } from '@prisma/client';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { resolveBinding, type PgBinding } from './merchant-binding';
import { lockReceivingAccount, precheckLimit, reserveLimit, releaseLimit, PgLimitError } from './limits';
import { paiseToInrString } from './money';
import { bindingToConfig, YOUPI_PROVIDER_NAME } from '../payments/youpi';
import {
  createYoupiSession,
  readYoupiPayment,
  findYoupiPaymentByOrderId,
  type YoupiConfig,
  type YoupiPaymentView,
} from '../payments/youpi-api';
import { reconcileYoupiPayment } from '../payments/youpi-reconcile';
import { markOrderPaymentFailed } from '../payments/reconcile';
import { OrderReviveError, PG_PAYABLE_ORDER, revivePaymentFailedOrder } from './order-state';

type Tx = Prisma.TransactionClient;

/** A create younger than this may still be executing on the gateway; do not conclude anything. */
export const UNKNOWN_GRACE_MS = 2 * 60_000;

const ALREADY_PAID: PgAttemptState[] = ['BANK_VERIFIED', 'CAPTURED', 'REFUND_PENDING', 'REFUNDED'];
const UNRESOLVED: PgAttemptState[] = ['CREATED', 'CREATE_UNKNOWN', 'OBSERVED', 'REVIEW_REQUIRED'];

export class PgAttemptError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PgAttemptError';
    this.status = status;
    this.code = code;
  }
}

export type PgSession = {
  /** Our Payment row id. */
  paymentId: string;
  attemptId: string;
  attemptKey: string;
  gatewayPaymentId: string;
  checkoutUrl: string;
  expiresAt: Date;
  amountPaise: number;
  /** True when an existing unexpired session was returned instead of creating one. */
  reused: boolean;
};

/** Collision-resistant, cuid-like id ('c' + time + 64 random bits); no dependency. */
export function newAttemptId(): string {
  return `c${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

/** Reasons the private readback does not prove the expected session; empty = match. */
export function readbackMismatch(
  view: YoupiPaymentView,
  expected: { attemptKey: string; amountPaise: number; vpa: string; gatewayPaymentId?: string | null },
): string[] {
  const reasons: string[] = [];
  if (expected.gatewayPaymentId && view.paymentId !== expected.gatewayPaymentId) reasons.push('paymentId');
  if (view.orderId !== expected.attemptKey) reasons.push('orderId');
  if (view.amountPaise !== expected.amountPaise) reasons.push('amount');
  if (view.currency !== 'INR') reasons.push('currency');
  if (!view.receiverVpa) reasons.push('receiver_missing');
  else if (view.receiverVpa !== expected.vpa) reasons.push('receiver');
  return reasons;
}

function checkoutOriginOk(cfg: YoupiConfig, checkoutUrl: string): boolean {
  if (!cfg.requireReceiverMatch) return true;
  const expected = process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
  if (!expected) return false;
  try {
    const u = new URL(checkoutUrl);
    return u.protocol === 'https:' && u.origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

async function openException(
  tx: Tx,
  kind: PgExceptionKind,
  a: { id: string; restaurantId: string; receivingAccountId: string; orderId: string; expectedAmountPaise: number },
  detail: Record<string, unknown>,
): Promise<void> {
  await openReconException(tx, {
    kind,
    dedupeKey: `${kind}:${a.id}`,
    restaurantId: a.restaurantId,
    receivingAccountId: a.receivingAccountId,
    attemptId: a.id,
    orderId: a.orderId,
    amountPaise: a.expectedAmountPaise,
    detail: detail as Prisma.InputJsonValue,
  });
}

async function closeException(tx: Tx, kind: PgExceptionKind, attemptId: string, resolution: string): Promise<void> {
  await tx.pgReconException.updateMany({
    where: { dedupeKey: `${kind}:${attemptId}`, status: { not: 'RESOLVED' } },
    data: { status: 'RESOLVED', resolution, resolvedAt: new Date() },
  });
}

/**
 * P0-2: everything createPgAttempt would refuse for reasons known before the order exists
 * (currency, amount > 0, merchant binding, checkout origin, limits), checked read-only so checkout can
 * refuse cleanly instead of committing a PAYMENT_PENDING order (and consuming coupon/wallet/points)
 * that can never be paid. Throws PgAttemptError with a customer-safe message.
 */
export async function precheckPgAttempt(
  o: { restaurantId: string; customerId: string },
  opts: { amountPaise: number; currency?: string; now?: Date },
): Promise<void> {
  if ((opts.currency ?? 'INR') !== 'INR') throw new PgAttemptError('Direct UPI (Flavrly PG) supports INR only.', 400, 'CURRENCY');
  if (!Number.isSafeInteger(opts.amountPaise) || opts.amountPaise <= 0) {
    throw new PgAttemptError(
      'Nothing is left to pay by UPI after wallet, points and discounts. Apply less wallet balance or points, or choose another payment method.',
      400,
      'AMOUNT',
    );
  }
  const binding = await resolveBinding(o.restaurantId, { forNew: true });
  if (!binding) throw new PgAttemptError('Direct UPI (Flavrly PG) is not available for this restaurant right now.', 400, 'NO_BINDING');
  if (bindingToConfig(binding).requireReceiverMatch && !process.env.FLAVRLY_PG_CHECKOUT_ORIGIN) {
    throw new PgAttemptError('Direct UPI (Flavrly PG) is not available right now. Choose another payment method.', 503, 'CONFIG');
  }
  try {
    await precheckLimit(prisma, {
      receivingAccountId: binding.receivingAccountId,
      amountPaise: opts.amountPaise,
      limits: binding.limits,
      customerId: o.customerId,
      now: opts.now,
    });
  } catch (e) {
    if (e instanceof PgLimitError) throw new PgAttemptError(e.message, 429, e.code);
    throw e;
  }
}

export async function createPgAttempt(
  order: { id: string; restaurantId: string; customerId: string; customer?: { name?: string | null; phone?: string | null } },
  opts: { amountPaise: number; method: PaymentMethod; currency?: string; redirectUrl?: string; now?: Date },
): Promise<PgSession> {
  const now = opts.now ?? new Date();
  const amountPaise = opts.amountPaise;
  if ((opts.currency ?? 'INR') !== 'INR') throw new PgAttemptError('Flavrly PG supports INR only.', 400, 'CURRENCY');
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new PgAttemptError('Order total must be greater than zero.', 400, 'AMOUNT');
  }

  const binding = await resolveBinding(order.restaurantId, { forNew: true });
  if (!binding) throw new PgAttemptError('Flavrly PG is not available for this restaurant.', 400, 'NO_BINDING');
  const cfg = bindingToConfig(binding);
  if (cfg.requireReceiverMatch && !process.env.FLAVRLY_PG_CHECKOUT_ORIGIN) {
    throw new PgAttemptError('Flavrly PG checkout origin is not configured.', 500, 'CONFIG');
  }

  const prep = await prisma
    .$transaction(async (tx) => {
      await lockReceivingAccount(tx, binding.receivingAccountId);

      const paid = await tx.payment.findFirst({ where: { orderId: order.id, status: 'CAPTURED' }, select: { id: true } });
      if (paid) throw new PgAttemptError('This order is already paid.', 409, 'ALREADY_PAID');

      // Order row lock (attempt creation and cancel/expiry serialise on it). Only an unpaid,
      // not-cancelled order may open a session.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const ord = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
      if (!ord) throw new PgAttemptError('Order not found.', 404, 'NOT_FOUND');
      if (!PG_PAYABLE_ORDER.includes(ord.status)) throw new PgAttemptError('This order can no longer be paid.', 409, 'NOT_PAYABLE');
      // P0-1: a retry after expiry/failure moves the order back to PAYMENT_PENDING in THIS transaction,
      // so the new attempt's bank credit is classified ORDER_PAYMENT, not LATE_PAYMENT.
      const revive = async () => {
        if (ord.status !== 'PAYMENT_FAILED') return;
        try {
          await revivePaymentFailedOrder(tx, order.id, 'Payment retried (Flavrly PG)');
        } catch (e) {
          if (e instanceof OrderReviveError) throw new PgAttemptError(e.message, 409, 'BENEFITS_RELEASED');
          throw e;
        }
      };

      const prior = await tx.pgPaymentAttempt.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
        include: {
          payment: { select: { id: true, providerData: true } },
          allocations: { where: { reversedAt: null }, select: { id: true } },
        },
      });
      for (const p of prior) {
        if (ALREADY_PAID.includes(p.state)) throw new PgAttemptError('This order is already paid.', 409, 'ALREADY_PAID');
        // A bank credit already allocated to ANY attempt (e.g. LATE_PAYMENT on an expired one)
        // means the customer's money arrived: never invite a second payment (H-06).
        if (p.allocations.length > 0) {
          throw new PgAttemptError(
            'Your payment for this order was received after the payment window closed. We are reviewing it and will confirm the order or refund you.',
            409,
            'LATE_PAYMENT_RECEIVED',
          );
        }
        if (UNRESOLVED.includes(p.state)) {
          throw new PgAttemptError(
            'A previous payment attempt for this order is still being confirmed. Please wait before trying again.',
            409,
            'ATTEMPT_UNRESOLVED',
          );
        }
        if (p.state === 'AWAITING_PAYMENT' && (!p.expiresAt || p.expiresAt > now)) {
          const url = (p.payment.providerData as Record<string, unknown> | null)?.checkoutUrl;
          const reusable =
            typeof url === 'string' &&
            !!p.gatewayPaymentId &&
            !!p.expiresAt &&
            p.expectedAmountPaise === amountPaise &&
            p.receivingAccountId === binding.receivingAccountId;
          if (!reusable) {
            throw new PgAttemptError('A payment for this order is already open. Please complete it or wait for it to expire.', 409, 'ATTEMPT_PENDING');
          }
          await revive();
          return { kind: 'reuse', attempt: p, checkoutUrl: url as string } as const;
        }
      }

      await revive();
      const attemptId = newAttemptId();
      const attemptKey = `${order.id}-${attemptId}`;
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: opts.method,
          status: 'PENDING',
          amount: paiseToInrString(amountPaise),
          currency: 'INR',
          providerName: YOUPI_PROVIDER_NAME,
          // Locatable by attemptKey (webhook/crash recovery) until the gateway paymentId is known.
          providerRef: attemptKey,
          providerData: { _merchantOrderId: attemptKey, attemptKey },
        },
      });
      const attempt = await tx.pgPaymentAttempt.create({
        data: {
          id: attemptId,
          paymentId: payment.id,
          orderId: order.id,
          restaurantId: order.restaurantId,
          receivingAccountId: binding.receivingAccountId,
          attemptKey,
          idempotencyKey: attemptKey,
          gatewayMerchantId: binding.gatewayMerchantId,
          expectedAmountPaise: amountPaise,
          currency: 'INR',
          state: 'CREATED',
        },
      });
      await reserveLimit(tx, {
        attemptId,
        receivingAccountId: binding.receivingAccountId,
        amountPaise,
        limits: binding.limits,
        customerId: order.customerId,
        now,
      });
      return { kind: 'created', attempt } as const;
    })
    .catch((e: unknown) => {
      if (e instanceof PgLimitError) throw new PgAttemptError(e.message, 429, e.code);
      throw e;
    });

  if (prep.kind === 'reuse') {
    const a = prep.attempt;
    return {
      paymentId: a.paymentId,
      attemptId: a.id,
      attemptKey: a.attemptKey,
      gatewayPaymentId: a.gatewayPaymentId!,
      checkoutUrl: prep.checkoutUrl,
      expiresAt: a.expiresAt!,
      amountPaise: a.expectedAmountPaise,
      reused: true,
    };
  }

  const attempt = prep.attempt;
  const out = await createYoupiSession(cfg, {
    orderId: attempt.attemptKey,
    amountPaise,
    customer: order.customer,
    redirectUrl: opts.redirectUrl,
  });

  if (out.kind === 'rejected') {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.pgPaymentAttempt.updateMany({
        where: { id: attempt.id, state: 'CREATED' },
        data: { state: 'FAILED', lastGatewayStatus: `HTTP_${out.httpStatus}`, lastStatusAt: new Date() },
      });
      if (moved.count === 0) return;
      await tx.payment.updateMany({ where: { id: attempt.paymentId, status: 'PENDING' }, data: { status: 'FAILED', errorMessage: out.error } });
      await releaseLimit(tx, attempt.id); // provably never payable: gateway created nothing
    });
    log.warn({ attemptId: attempt.id, orderId: order.id, httpStatus: out.httpStatus }, 'pg.attempt.create_rejected');
    throw new PgAttemptError('Could not start the payment. Please try again or choose another method.', 502, 'GATEWAY_REJECTED');
  }

  if (out.kind === 'unknown') {
    await markUnknown(attempt, null, out.error);
    throw new PgAttemptError('We could not confirm the payment session. Please wait a minute before retrying.', 503, 'CREATE_UNKNOWN');
  }

  const rb = await readYoupiPayment(cfg, out.paymentId);
  if (rb.kind !== 'found') {
    // The session exists but its receiver cannot be proven yet: unknown, never exposed.
    await markUnknown(attempt, out.paymentId, rb.kind === 'error' ? `readback: ${rb.error}` : 'readback: not found', out.checkoutUrl);
    throw new PgAttemptError('We could not confirm the payment session. Please wait a minute before retrying.', 503, 'CREATE_UNKNOWN');
  }
  const reasons = readbackMismatch(rb.view, {
    attemptKey: attempt.attemptKey,
    amountPaise,
    vpa: binding.vpa,
    gatewayPaymentId: out.paymentId,
  });
  if (!checkoutOriginOk(cfg, out.checkoutUrl)) reasons.push('checkout_origin');
  if (reasons.length > 0) {
    await markReview(attempt, out.paymentId, reasons, rb.view);
    throw new PgAttemptError('This payment could not be started safely. The restaurant has been notified.', 502, 'RECEIVER_MISMATCH');
  }

  const expiresAt = new Date(now.getTime() + binding.limits.sessionTtlMinutes * 60_000);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.pgPaymentAttempt.updateMany({
      where: { id: attempt.id, state: 'CREATED' },
      data: {
        state: 'AWAITING_PAYMENT',
        gatewayPaymentId: out.paymentId,
        expiresAt,
        lastGatewayStatus: rb.view.gatewayStatus,
        lastStatusAt: new Date(),
      },
    });
    if (moved.count === 0) throw new PgAttemptError('Payment attempt changed concurrently.', 409, 'ATTEMPT_RACE');
    await tx.payment.update({
      where: { id: attempt.paymentId },
      data: {
        providerRef: out.paymentId,
        providerData: {
          paymentId: out.paymentId,
          checkoutUrl: out.checkoutUrl,
          _merchantOrderId: attempt.attemptKey,
          attemptKey: attempt.attemptKey,
          _expireAt: expiresAt.getTime(),
        },
      },
    });
  });

  return {
    paymentId: attempt.paymentId,
    attemptId: attempt.id,
    attemptKey: attempt.attemptKey,
    gatewayPaymentId: out.paymentId,
    checkoutUrl: out.checkoutUrl,
    expiresAt,
    amountPaise,
    reused: false,
  };
}

type AttemptRef = {
  id: string;
  paymentId: string;
  restaurantId: string;
  receivingAccountId: string;
  orderId: string;
  attemptKey: string;
  expectedAmountPaise: number;
};

async function markUnknown(a: AttemptRef, gatewayPaymentId: string | null, error: string, checkoutUrl?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const moved = await tx.pgPaymentAttempt.updateMany({
      where: { id: a.id, state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
      data: { state: 'CREATE_UNKNOWN', ...(gatewayPaymentId ? { gatewayPaymentId } : {}), lastStatusAt: new Date() },
    });
    if (moved.count === 1 && checkoutUrl && gatewayPaymentId) {
      // P1-8: kept server-side only (never shown while unknown); reused once the readback proves the receiver.
      await tx.payment.update({
        where: { id: a.paymentId },
        data: { providerData: { paymentId: gatewayPaymentId, checkoutUrl, _merchantOrderId: a.attemptKey, attemptKey: a.attemptKey, unverified: true } },
      });
    }
    await openException(tx, 'CREATE_UNKNOWN', a, { gatewayPaymentId, error: error.slice(0, 200) });
  });
  // The limit reservation is deliberately kept: the remote session may still be paid.
  log.warn({ attemptId: a.id, orderId: a.orderId }, 'pg.attempt.create_unknown');
}

async function markReview(a: AttemptRef, gatewayPaymentId: string | null, reasons: string[], view: YoupiPaymentView): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.pgPaymentAttempt.updateMany({
      where: { id: a.id, state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
      data: {
        state: 'REVIEW_REQUIRED',
        ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
        reviewReason: `readback mismatch: ${reasons.join(',')}`,
        lastGatewayStatus: view.gatewayStatus || null,
        lastStatusAt: new Date(),
      },
    });
    await tx.payment.updateMany({
      where: { id: a.paymentId, status: 'PENDING' },
      data: { errorMessage: 'Gateway session failed receiver/amount/order verification; operator review required.' },
    });
    await openException(tx, 'RECEIVER_MISMATCH', a, {
      gatewayPaymentId,
      reasons,
      observed: { orderId: view.orderId, amountPaise: view.amountPaise, currency: view.currency, receiverVpa: view.receiverVpa },
    });
    await closeException(tx, 'CREATE_UNKNOWN', a.id, 'superseded by RECEIVER_MISMATCH');
  });
  log.error({ attemptId: a.id, orderId: a.orderId, reasons }, 'pg.attempt.receiver_mismatch');
}

/**
 * Settles a CREATED / CREATE_UNKNOWN attempt from the gateway's own records.
 * Returns the attempt state after the call (unchanged when nothing can be proven yet).
 */
export async function resolveUnknownAttempt(attemptId: string, now: Date = new Date()): Promise<PgAttemptState | null> {
  const a = await prisma.pgPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!a) return null;
  if (a.state !== 'CREATED' && a.state !== 'CREATE_UNKNOWN') return a.state;
  if (now.getTime() - a.createdAt.getTime() < UNKNOWN_GRACE_MS) return a.state;

  // Reconciliation view: a disabled/suspended merchant must still resolve its attempts.
  const binding: PgBinding | null = await resolveBinding(a.restaurantId, { forNew: false, receivingAccountId: a.receivingAccountId });
  if (!binding || binding.gatewayMerchantId !== a.gatewayMerchantId) {
    log.warn({ attemptId }, 'pg.attempt.resolve_no_binding');
    return a.state;
  }
  const cfg = bindingToConfig(binding);
  const r = a.gatewayPaymentId ? await readYoupiPayment(cfg, a.gatewayPaymentId) : await findYoupiPaymentByOrderId(cfg, a.attemptKey);

  if (r.kind === 'error') return a.state;

  if (r.kind === 'not_found') {
    // A known gatewayPaymentId that 404s is an anomaly, not proof of absence.
    if (a.gatewayPaymentId) return a.state;
    let settled = false;
    await prisma.$transaction(async (tx) => {
      const moved = await tx.pgPaymentAttempt.updateMany({
        where: { id: a.id, state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
        data: { state: 'FAILED', lastGatewayStatus: 'NOT_FOUND', lastStatusAt: new Date() },
      });
      if (moved.count === 0) return;
      settled = true;
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: 'Gateway has no session for this attempt.' },
      });
      await releaseLimit(tx, a.id); // provably never payable
      await closeException(tx, 'CREATE_UNKNOWN', a.id, 'gateway lookup: no session exists');
    });
    if (settled) return 'FAILED';
    return (await prisma.pgPaymentAttempt.findUnique({ where: { id: a.id } }))?.state ?? null;
  }

  const view = r.view;
  const reasons = readbackMismatch(view, {
    attemptKey: a.attemptKey,
    amountPaise: a.expectedAmountPaise,
    vpa: binding.vpa,
    gatewayPaymentId: a.gatewayPaymentId,
  });
  if (!view.paymentId) reasons.push('paymentId_missing');
  if (reasons.length > 0) {
    await markReview(a, view.paymentId ?? a.gatewayPaymentId, reasons, view);
    return 'REVIEW_REQUIRED';
  }

  let next: PgAttemptState;
  if (view.gatewayStatus === 'EXPIRED') next = 'EXPIRED';
  else if (view.gatewayStatus === 'FAILED' || view.gatewayStatus === 'CANCELLED') next = 'FAILED';
  else if (view.status === 'PENDING' || view.status === 'OBSERVED') next = 'AWAITING_PAYMENT';
  else return a.state; // unrecognised gateway status: prove nothing

  // P1-8: an AWAITING_PAYMENT attempt is only reusable with a checkout URL. Keep the one from the
  // create response if we have it; otherwise re-POST the same attemptKey: the gateway de-duplicates by
  // (merchant, orderId) and returns the SAME live session + checkoutUrl (UPSTREAM_CONTRACT §2).
  let checkoutUrl: string | null = null;
  if (next === 'AWAITING_PAYMENT') {
    const pay = await prisma.payment.findUnique({ where: { id: a.paymentId }, select: { providerData: true } });
    const kept = (pay?.providerData as Record<string, unknown> | null)?.checkoutUrl;
    if (typeof kept === 'string' && checkoutOriginOk(cfg, kept)) checkoutUrl = kept;
    else {
      const again = await createYoupiSession(cfg, { orderId: a.attemptKey, amountPaise: a.expectedAmountPaise });
      if (again.kind === 'created' && again.paymentId === view.paymentId && checkoutOriginOk(cfg, again.checkoutUrl)) checkoutUrl = again.checkoutUrl;
    }
  }

  // The session existed and was payable, so the limit is NOT released for FAILED/EXPIRED.
  // An OBSERVED (SUCCESS) session stays AWAITING_PAYMENT here; the reconciliation probe records
  // the observation and only bank evidence can capture it (D2/D3).
  await prisma.$transaction(async (tx) => {
    const moved = await tx.pgPaymentAttempt.updateMany({
      where: { id: a.id, state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
      data: {
        state: next,
        gatewayPaymentId: view.paymentId!,
        ...(next === 'AWAITING_PAYMENT' ? { expiresAt: new Date(now.getTime() + binding.limits.sessionTtlMinutes * 60_000) } : {}),
        lastGatewayStatus: view.gatewayStatus,
        lastStatusAt: new Date(),
      },
    });
    if (moved.count === 0) return;
    const expiresAt = next === 'AWAITING_PAYMENT' ? new Date(now.getTime() + binding.limits.sessionTtlMinutes * 60_000) : null;
    await tx.payment.update({
      where: { id: a.paymentId },
      data: {
        providerRef: view.paymentId!,
        ...(next === 'AWAITING_PAYMENT'
          ? {
              providerData: {
                paymentId: view.paymentId!,
                ...(checkoutUrl ? { checkoutUrl } : {}),
                _merchantOrderId: a.attemptKey,
                attemptKey: a.attemptKey,
                _expireAt: expiresAt!.getTime(),
              },
            }
          : {}),
      },
    });
    if (next !== 'AWAITING_PAYMENT') {
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: `Gateway session ${view.gatewayStatus}.` },
      });
      // P2 daily cap: the gateway itself reports the session dead and nothing was observed for it.
      const observed = await tx.pgPaymentEvidence.count({ where: { attemptId: a.id } });
      if (observed === 0) await releaseLimit(tx, a.id);
    }
    await closeException(tx, 'CREATE_UNKNOWN', a.id, `gateway lookup: ${view.gatewayStatus}`);
  });
  return next;
}

/** Past-expiry slack before a quiet AWAITING_PAYMENT attempt is expired, and before a stuck attempt is flagged. */
export const STALE_GRACE_MS = 30 * 60_000;
/** P1-8: minimum gap between two gateway probes of the same CREATED/CREATE_UNKNOWN attempt. */
export const UNKNOWN_REPROBE_MS = 90_000;
/**
 * P1-9: while the gateway still reports the session live (INITIATED/QUEUED/ACTIVE), it is not expired
 * until expiresAt + this bound; after that it is expired anyway (a later payment becomes LATE_PAYMENT).
 */
export const LIVE_SESSION_MAX_EXTENSION_MS = 2 * 3_600_000;
/** OBSERVED is normal until the next bank statement: flag only after the bank-match window. */
export const OBSERVED_STALE_MS = 48 * 3600_000;
const FLAG_SCAN_PAGES = 10;

const NOT_FINAL: PgAttemptState[] = ['CREATED', 'CREATE_UNKNOWN', 'AWAITING_PAYMENT', 'OBSERVED', 'BANK_VERIFIED', 'CAPTURED', 'REVIEW_REQUIRED'];

/**
 * Worker stage (run from the pg-worker tick): advances attempts nobody else will advance.
 *
 *  - CREATED / CREATE_UNKNOWN older than the grace: resolveUnknownAttempt(); still unresolved
 *    -> STALE_PENDING exception (never expired blindly).
 *  - OBSERVED / REVIEW_REQUIRED older than the grace: STALE_PENDING exception only.
 *  - AWAITING_PAYMENT past expiresAt + grace with no gateway/observer evidence and no allocation:
 *    one private status probe. Gateway SUCCESS -> left alone (handed to reconcileYoupiPayment so
 *    the observation is recorded). Otherwise -> EXPIRED; the limit is released only when the
 *    gateway itself confirms FAILED/EXPIRED/CANCELLED. The Payment goes FAILED and, if the order
 *    has no other non-final attempt, the order moves to PAYMENT_FAILED (markOrderPaymentFailed).
 *    A late bank credit after this is a LATE_PAYMENT for reconciliation (Agent C).
 */
export async function expireStaleAttempts(
  opts: { now?: Date; graceMs?: number; limit?: number } = {},
): Promise<{ expired: number; released: number; ordersFailed: number; resolved: number; flagged: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const graceMs = opts.graceMs ?? STALE_GRACE_MS;
  const limit = opts.limit ?? 50;
  const cutoff = new Date(now.getTime() - graceMs);
  const res = { expired: 0, released: 0, ordersFailed: 0, resolved: 0, flagged: 0, skipped: 0 };

  // 1a. Unknown creates get their own query, so a backlog of OBSERVED/REVIEW attempts can never
  //     starve them (H-10). An attempt we could not resolve is touched (updatedAt bumps), which
  //     rotates it behind the others for the next tick.
  //     P1-8: probed every UNKNOWN_REPROBE_MS (not only after the 30 min grace), so a timed-out create
  //     that the gateway did make becomes payable again within minutes; STALE_PENDING only after the grace.
  const unknown = await prisma.pgPaymentAttempt.findMany({
    where: { state: { in: ['CREATED', 'CREATE_UNKNOWN'] }, updatedAt: { lt: new Date(now.getTime() - UNKNOWN_REPROBE_MS) } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  for (const a of unknown) {
    const state = await resolveUnknownAttempt(a.id, now).catch(() => a.state);
    if (state !== a.state) {
      res.resolved++;
      continue;
    }
    const stale = a.createdAt < cutoff;
    await prisma.$transaction(async (tx) => {
      await tx.pgPaymentAttempt.updateMany({ where: { id: a.id, state: a.state }, data: { lastStatusAt: now } });
      if (stale) await openException(tx, 'STALE_PENDING', a, { state, since: a.createdAt.toISOString() });
    });
    if (stale) res.flagged++;
  }

  // 1b. REVIEW_REQUIRED past the grace, OBSERVED past the bank-match window: flag once each.
  //     Already-flagged attempts are skipped while paging, so new ones always get flagged.
  let afterId: string | undefined;
  for (let page = 0, flagged = 0; page < FLAG_SCAN_PAGES && flagged < limit; page++) {
    const batch = await prisma.pgPaymentAttempt.findMany({
      where: {
        OR: [
          // createdAt, not updatedAt: every sweep probe bumps updatedAt, so the alert would never fire.
          { state: 'REVIEW_REQUIRED', createdAt: { lt: cutoff } },
          { state: 'OBSERVED', createdAt: { lt: new Date(now.getTime() - OBSERVED_STALE_MS) } },
        ],
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
    if (batch.length === 0) break;
    const done = new Set(
      (
        await prisma.pgReconException.findMany({
          where: { dedupeKey: { in: batch.map((a) => `STALE_PENDING:${a.id}`) } },
          select: { attemptId: true },
        })
      ).map((e) => e.attemptId),
    );
    for (const a of batch) {
      if (done.has(a.id) || flagged >= limit) continue;
      await prisma.$transaction((tx) => openException(tx, 'STALE_PENDING', a, { state: a.state, since: a.createdAt.toISOString() }));
      res.flagged++;
      flagged++;
    }
    if (batch.length < limit) break;
    afterId = batch[batch.length - 1].id;
  }

  // 2. Quiet sessions past their window.
  const due = await prisma.pgPaymentAttempt.findMany({
    where: {
      state: 'AWAITING_PAYMENT',
      expiresAt: { lt: cutoff },
      evidence: { none: { status: { not: 'REJECTED' } } },
      allocations: { none: {} },
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  });
  for (const a of due) {
    const binding = await resolveBinding(a.restaurantId, { forNew: false, receivingAccountId: a.receivingAccountId });
    if (!binding || binding.gatewayMerchantId !== a.gatewayMerchantId || !a.gatewayPaymentId) {
      res.skipped++;
      continue;
    }
    const r = await readYoupiPayment(bindingToConfig(binding), a.gatewayPaymentId);
    if (r.kind !== 'found' || r.view.status === 'UNKNOWN') {
      res.skipped++; // cannot prove anything this tick
      continue;
    }
    if (r.view.status === 'OBSERVED') {
      // The gateway saw a payment: never expire. Let the reconcile path record the observation.
      try {
        await reconcileYoupiPayment(a.paymentId);
      } catch (e) {
        log.warn({ attemptId: a.id, err: (e as Error).message }, 'pg.expiry.reconcile_failed');
      }
      res.skipped++;
      continue;
    }
    if (r.view.status === 'PENDING' && a.expiresAt && now.getTime() < a.expiresAt.getTime() + LIVE_SESSION_MAX_EXTENSION_MS) {
      res.skipped++; // P1-9: gateway says the session is still live; give it the bounded extension
      continue;
    }
    const gatewayDead = r.view.status === 'FAILED';
    let moved = false;
    await prisma.$transaction(async (tx) => {
      const upd = await tx.pgPaymentAttempt.updateMany({
        where: { id: a.id, state: 'AWAITING_PAYMENT' },
        data: { state: 'EXPIRED', lastGatewayStatus: r.view.gatewayStatus, lastStatusAt: new Date() },
      });
      if (upd.count === 0) return;
      moved = true;
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: `Flavrly PG session expired (gateway ${r.view.gatewayStatus}).` },
      });
      if (gatewayDead && (await releaseLimit(tx, a.id))) res.released++;
    });
    if (!moved) continue;
    res.expired++;
    const others = await prisma.pgPaymentAttempt.count({ where: { orderId: a.orderId, id: { not: a.id }, state: { in: NOT_FINAL } } });
    if (others === 0 && (await markOrderPaymentFailed(a.orderId, 'Flavrly PG payment window expired without payment'))) {
      res.ordersFailed++;
    }
  }
  return res;
}

function envMinutes(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** P0-2/P0-4: a PG order with no live attempt for this long goes PAYMENT_FAILED (customer may retry). */
export const ORPHAN_ORDER_MS = envMinutes('FLAVRLY_PG_ORPHAN_ORDER_MINUTES', 30) * 60_000;
/** P1-10: an unpaid PAYMENT_FAILED PG order quiet for this long is cancelled, releasing its benefits. */
export const UNPAID_CANCEL_MS = envMinutes('FLAVRLY_PG_UNPAID_CANCEL_HOURS', 24) * 3_600_000;

const LIVE_STATES: PgAttemptState[] = ['CREATED', 'CREATE_UNKNOWN', 'AWAITING_PAYMENT', 'OBSERVED', 'BANK_VERIFIED', 'CAPTURED', 'REVIEW_REQUIRED'];

/** PG prepay orders in `status` with nothing that can still become money, quiet since `cutoff`. */
async function quietPgOrders(status: 'PAYMENT_PENDING' | 'PAYMENT_FAILED', cutoff: Date, limit: number): Promise<string[]> {
  const at = Prisma.sql`(${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const live = Prisma.join(LIVE_STATES.map((s) => Prisma.sql`${s}::"PgAttemptState"`));
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM "Order" o
    WHERE o.status = ${status}::"OrderStatus" AND o."createdAt" < ${at}
      AND EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e.status = 'PAYMENT_PENDING')
      AND NOT EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e."createdAt" >= ${at})
      AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id
                      AND (p."providerName" IS DISTINCT FROM 'youpi' OR p.status IN ('CAPTURED', 'REFUNDED')))
      AND NOT EXISTS (SELECT 1 FROM "PgPaymentAttempt" a WHERE a."orderId" = o.id AND (a.state IN (${live}) OR a."updatedAt" >= ${at}))
      AND NOT EXISTS (SELECT 1 FROM "PgAllocation" l WHERE l."orderId" = o.id AND l."reversedAt" IS NULL)
      AND NOT EXISTS (SELECT 1 FROM "PgOutbox" x WHERE x."aggregateId" = o.id AND x.topic = 'ORDER_RELEASE' AND x.status <> 'DONE')
      AND NOT EXISTS (SELECT 1 FROM "PgReconException" r WHERE r."orderId" = o.id AND r.kind = 'RELEASE_HELD' AND r.status <> 'RESOLVED')
    ORDER BY o."createdAt" ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/**
 * Worker stage for orders nobody else advances:
 *  1. PAYMENT_PENDING PG order with no live attempt (create refused/rejected after commit, gateway
 *     FAILED, voided attempt) -> PAYMENT_FAILED, so it is never stuck and the customer can retry.
 *  2. PAYMENT_FAILED PG order, unpaid and untouched for UNPAID_CANCEL_MS -> CANCELLED_BY_ADMIN, which
 *     releases coupon/wallet/points/signup bonus/freebie (transitionOrder). A credit after that is a
 *     LATE_PAYMENT for refund.
 */
export async function sweepUnpaidPgOrders(
  opts: { now?: Date; limit?: number } = {},
): Promise<{ failed: number; cancelled: number }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const out = { failed: 0, cancelled: 0 };
  for (const id of await quietPgOrders('PAYMENT_PENDING', new Date(now.getTime() - ORPHAN_ORDER_MS), limit)) {
    if (await markOrderPaymentFailed(id, 'Flavrly PG: no payment session is open for this order')) out.failed++;
  }
  const { transitionOrder } = await import('../orders');
  for (const id of await quietPgOrders('PAYMENT_FAILED', new Date(now.getTime() - UNPAID_CANCEL_MS), limit)) {
    try {
      await transitionOrder(id, 'CANCELLED_BY_ADMIN', { note: 'Unpaid Flavrly PG order closed automatically' });
      out.cancelled++;
    } catch (e) {
      log.warn({ orderId: id, err: (e as Error).message }, 'pg.unpaid_cancel_failed');
    }
  }
  return out;
}
