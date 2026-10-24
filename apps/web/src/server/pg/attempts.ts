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

import crypto from 'node:crypto';
import type { PaymentMethod, PgAttemptState, PgExceptionKind, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { resolveBinding, type PgBinding } from './merchant-binding';
import { lockReceivingAccount, reserveLimit, releaseLimit, PgLimitError } from './limits';
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
  // TODO(lead): switch to pg/exceptions.ts openException() once Agent C's module lands.
  const dedupeKey = `${kind}:${a.id}`;
  await tx.pgReconException.upsert({
    where: { dedupeKey },
    create: {
      kind,
      restaurantId: a.restaurantId,
      receivingAccountId: a.receivingAccountId,
      attemptId: a.id,
      orderId: a.orderId,
      amountPaise: a.expectedAmountPaise,
      detail: detail as Prisma.InputJsonValue,
      dedupeKey,
    },
    update: {},
  });
}

async function closeException(tx: Tx, kind: PgExceptionKind, attemptId: string, resolution: string): Promise<void> {
  await tx.pgReconException.updateMany({
    where: { dedupeKey: `${kind}:${attemptId}`, status: { not: 'RESOLVED' } },
    data: { status: 'RESOLVED', resolution, resolvedAt: new Date() },
  });
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

      const prior = await tx.pgPaymentAttempt.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
        include: { payment: { select: { id: true, providerData: true } } },
      });
      for (const p of prior) {
        if (ALREADY_PAID.includes(p.state)) throw new PgAttemptError('This order is already paid.', 409, 'ALREADY_PAID');
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
          return { kind: 'reuse', attempt: p, checkoutUrl: url as string } as const;
        }
      }

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
    await markUnknown(attempt, out.paymentId, rb.kind === 'error' ? `readback: ${rb.error}` : 'readback: not found');
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

async function markUnknown(a: AttemptRef, gatewayPaymentId: string | null, error: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.pgPaymentAttempt.updateMany({
      where: { id: a.id, state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
      data: { state: 'CREATE_UNKNOWN', ...(gatewayPaymentId ? { gatewayPaymentId } : {}), lastStatusAt: new Date() },
    });
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
    await tx.payment.update({ where: { id: a.paymentId }, data: { providerRef: view.paymentId! } });
    if (next !== 'AWAITING_PAYMENT') {
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: `Gateway session ${view.gatewayStatus}.` },
      });
    }
    await closeException(tx, 'CREATE_UNKNOWN', a.id, `gateway lookup: ${view.gatewayStatus}`);
  });
  return next;
}

/** Past-expiry slack before a quiet AWAITING_PAYMENT attempt is expired, and before a stuck attempt is flagged. */
export const STALE_GRACE_MS = 30 * 60_000;

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
export async function expireStalePgAttempts(
  opts: { now?: Date; graceMs?: number; limit?: number } = {},
): Promise<{ expired: number; released: number; ordersFailed: number; resolved: number; flagged: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const graceMs = opts.graceMs ?? STALE_GRACE_MS;
  const limit = opts.limit ?? 50;
  const cutoff = new Date(now.getTime() - graceMs);
  const res = { expired: 0, released: 0, ordersFailed: 0, resolved: 0, flagged: 0, skipped: 0 };

  // 1. Stuck attempts: try to resolve unknown creates, flag the rest.
  const stuck = await prisma.pgPaymentAttempt.findMany({
    where: { state: { in: ['CREATED', 'CREATE_UNKNOWN', 'OBSERVED', 'REVIEW_REQUIRED'] }, updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  for (const a of stuck) {
    let state: PgAttemptState | null = a.state;
    if (a.state === 'CREATED' || a.state === 'CREATE_UNKNOWN') {
      state = await resolveUnknownAttempt(a.id, now).catch(() => a.state);
      if (state !== a.state) {
        res.resolved++;
        continue;
      }
    }
    await prisma.$transaction((tx) => openException(tx, 'STALE_PENDING', a, { state, since: a.updatedAt.toISOString() }));
    res.flagged++;
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
