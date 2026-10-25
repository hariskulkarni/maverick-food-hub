/**
 * Flavrly PG order release — outbox handler for topic ORDER_RELEASE (contract D6).
 *
 * `allocateBankCredit()` commits the allocation, sets the attempt + Payment
 * CAPTURED and enqueues ORDER_RELEASE in ONE transaction. This handler then
 * moves the order PAYMENT_PENDING -> RECEIVED through the normal
 * `transitionOrder`, so kitchen visibility, realtime events, customer SMS/push
 * and the restaurant's auto-accept policy fire exactly as for any paid order.
 *
 * Idempotent and retry-safe (the outbox may deliver more than once):
 *   - order PAYMENT_PENDING          -> release (RECEIVED), then auto-accept policy
 *   - order already released         -> no-op success (auto-accept re-checked, see below)
 *   - order cancelled / failed first -> NOT released; LATE_PAYMENT exception upserted
 *   - attempt/payment not CAPTURED   -> throws (never release on unverified money)
 *   - DB/transient errors            -> thrown so the outbox retries
 *
 * Side-effect delivery on retry (investigated):
 *   transitionOrder commits the status first and only then publishes realtime
 *   events and sends SMS/push. Its DB write is guarded on the previous status
 *   (`updateMany where status = old`), so two concurrent deliveries cannot both
 *   win: the loser either hits transitionOrder's same-state early return or
 *   gets OrderTransitionError and this handler re-reads and no-ops (proven in
 *   tests/db/d-kitchen-release.test.ts: one RECEIVED event, one SMS, one
 *   kitchen publish). A retry after a crash sees RECEIVED and no-ops, so notifications are
 *   AT MOST ONCE, never doubled. Residual risk: a crash between the status
 *   commit and the notifications loses the customer SMS/push and the SSE nudge.
 *   The kitchen still sees the order via its 15s DB snapshot poll. Auto-accept
 *   is re-applied on the no-op path (maybeAutoAccept only acts on RECEIVED and
 *   is itself guarded), which closes the crash window for that step.
 */

import { openException } from './exceptions';
import { OrderStatus, PaymentStatus, PgAttemptState } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { OrderTransitionError, maybeAutoAccept, transitionOrder } from '../orders';

export interface OrderReleasePayload {
  orderId: string;
  attemptId: string;
  paymentId: string;
  /** Set when a restaurant admin already confirmed this order (accepted late payment): no stale hold, no auto-accept. */
  restaurantConfirmedById?: string;
}

/**
 * P1-6: a capture this long after the order was placed does not go to the kitchen on its own: the
 * restaurant must confirm it first (RELEASE_HELD exception, merchant PG page), and auto-accept is
 * never applied to it. FLAVRLY_PG_STALE_RELEASE_MINUTES, default 90.
 */
export function staleReleaseMs(): number {
  const v = Number(process.env.FLAVRLY_PG_STALE_RELEASE_MINUTES);
  return (Number.isFinite(v) && v > 0 ? v : 90) * 60_000;
}

export const heldStaleDedupeKey = (orderId: string) => `RELEASE_HELD:stale:${orderId}`;

export type OrderReleaseResult =
  | { outcome: 'RELEASED'; orderId: string }
  | { outcome: 'HELD_FOR_RESTAURANT'; orderId: string; exceptionDedupeKey: string }
  | { outcome: 'ALREADY_RELEASED'; orderId: string; orderStatus: OrderStatus }
  | { outcome: 'LATE_PAYMENT'; orderId: string; orderStatus: OrderStatus; exceptionDedupeKey: string };

/** Statuses from which a captured payment must NOT put the order in front of the kitchen. */
const NOT_RELEASABLE: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUND_INITIATED,
  OrderStatus.REFUNDED,
]);

export function lateExceptionDedupeKey(attemptId: string): string {
  return `LATE_PAYMENT:${attemptId}`;
}

export async function handleOrderRelease(payload: OrderReleasePayload): Promise<OrderReleaseResult> {
  const { orderId, attemptId, paymentId, restaurantConfirmedById } = payload ?? ({} as OrderReleasePayload);
  if (!orderId || !attemptId || !paymentId) throw new Error('ORDER_RELEASE: payload missing orderId/attemptId/paymentId');

  const attempt = await prisma.pgPaymentAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      orderId: true,
      paymentId: true,
      restaurantId: true,
      receivingAccountId: true,
      expectedAmountPaise: true,
      state: true,
      payment: { select: { status: true } },
    },
  });
  if (!attempt) throw new Error(`ORDER_RELEASE: attempt ${attemptId} not found`);
  if (attempt.orderId !== orderId || attempt.paymentId !== paymentId) {
    throw new Error(`ORDER_RELEASE: payload does not match attempt ${attemptId}`);
  }
  // Defence in depth: only money captured by allocateBankCredit() releases food.
  if (attempt.state !== PgAttemptState.CAPTURED || attempt.payment.status !== PaymentStatus.CAPTURED) {
    throw new Error(`ORDER_RELEASE: attempt ${attemptId} is not CAPTURED (state=${attempt.state}, payment=${attempt.payment.status})`);
  }

  // At most two passes: the second only after losing a concurrent transition race.
  for (let pass = 0; pass < 2; pass += 1) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, createdAt: true, branch: { select: { restaurantId: true } } },
    });
    if (!order) throw new Error(`ORDER_RELEASE: order ${orderId} not found`);

    if (order.status === OrderStatus.PAYMENT_PENDING) {
      const ageMs = Date.now() - order.createdAt.getTime();
      if (!restaurantConfirmedById && ageMs > staleReleaseMs()) {
        // P1-6: too old to cook unannounced. Hold until a restaurant admin confirms (or declines -> refund).
        const exceptionDedupeKey = heldStaleDedupeKey(orderId);
        await openException(prisma, {
          kind: 'RELEASE_HELD',
          dedupeKey: exceptionDedupeKey,
          restaurantId: attempt.restaurantId,
          receivingAccountId: attempt.receivingAccountId,
          attemptId,
          orderId,
          amountPaise: attempt.expectedAmountPaise,
          detail: { reason: 'stale_release', paymentId, ageMinutes: Math.round(ageMs / 60_000), thresholdMinutes: Math.round(staleReleaseMs() / 60_000) },
        });
        log.warn({ orderId, attemptId, ageMinutes: Math.round(ageMs / 60_000) }, 'pg.release.held_stale');
        return { outcome: 'HELD_FOR_RESTAURANT', orderId, exceptionDedupeKey };
      }
      try {
        await transitionOrder(orderId, OrderStatus.RECEIVED, {
          note: restaurantConfirmedById ? 'Late payment accepted and confirmed by the restaurant (Flavrly PG)' : 'Payment bank-verified (Flavrly PG)',
          actorId: restaurantConfirmedById,
          pgRelease: true,
        });
      } catch (e) {
        if (e instanceof OrderTransitionError && pass === 0) continue; // re-read and classify
        throw e;
      }
      if (!restaurantConfirmedById) await applyAutoAccept(orderId, order.branch.restaurantId);
      log.info({ orderId, attemptId }, 'pg.release.released');
      return { outcome: 'RELEASED', orderId };
    }

    if (NOT_RELEASABLE.has(order.status) && !(await wasEverReleased(orderId))) {
      const exceptionDedupeKey = lateExceptionDedupeKey(attemptId);
      await openException(prisma, {
          kind: 'LATE_PAYMENT',
          dedupeKey: exceptionDedupeKey,
          restaurantId: attempt.restaurantId,
          receivingAccountId: attempt.receivingAccountId,
          attemptId,
          orderId,
          amountPaise: attempt.expectedAmountPaise,
          detail: { orderStatus: order.status, paymentId, reason: 'captured after order left PAYMENT_PENDING' },
        });
      log.warn({ orderId, attemptId, orderStatus: order.status }, 'pg.release.late_payment');
      return { outcome: 'LATE_PAYMENT', orderId, orderStatus: order.status, exceptionDedupeKey };
    }

    // Already RECEIVED or further (or cancelled AFTER a release, which the refund flow owns).
    if (order.status === OrderStatus.RECEIVED && !restaurantConfirmedById && !(await wasHeld(orderId))) {
      await applyAutoAccept(orderId, order.branch.restaurantId);
    }
    return { outcome: 'ALREADY_RELEASED', orderId, orderStatus: order.status };
  }
  throw new Error(`ORDER_RELEASE: order ${orderId} kept changing concurrently`);
}

/** True when this order's release was held for restaurant confirmation (never auto-accepted). */
async function wasHeld(orderId: string): Promise<boolean> {
  return (await prisma.pgReconException.count({ where: { orderId, kind: 'RELEASE_HELD' } })) > 0;
}

// ───────────────────────────── restaurant decision on a held release ─────────────────────────────

export class HeldReleaseError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export interface HeldDecisionResult {
  exceptionId: string;
  orderId: string;
  decision: 'CONFIRMED' | 'DECLINED';
  reason: 'stale_release' | 'late_payment_accepted';
  outcome: string;
}

/**
 * A restaurant ADMIN decides on a RELEASE_HELD order of ITS restaurant (merchant PG page).
 *  - stale_release + CONFIRM: the captured order goes to the kitchen now (RECEIVED, no auto-accept).
 *  - late_payment_accepted + CONFIRM: capture via allocateBankCredit({acceptLate}) (two ops approvals
 *    already recorded), then the ORDER_RELEASE outbox releases it (no auto-accept).
 *  - DECLINE: the order is cancelled (CANCELLED_BY_ADMIN, note says the restaurant declined) and the
 *    exception stays in the ops queue (ACKNOWLEDGED) for the refund.
 */
export async function decideHeldRelease(input: {
  exceptionId: string;
  restaurantId: string;
  actorId: string;
  decision: 'CONFIRM' | 'DECLINE';
  note?: string;
}): Promise<HeldDecisionResult> {
  const actorId = input.actorId?.trim();
  if (!actorId) throw new HeldReleaseError('A signed-in restaurant admin is required.', 401);
  const ex = await prisma.pgReconException.findUnique({ where: { id: input.exceptionId } });
  if (!ex || ex.kind !== 'RELEASE_HELD' || ex.restaurantId !== input.restaurantId || !ex.orderId || !ex.attemptId) {
    throw new HeldReleaseError('Held order not found.', 404);
  }
  if (ex.status !== 'OPEN') throw new HeldReleaseError('This order was already decided.');
  const detail = (ex.detail ?? {}) as Record<string, unknown>;
  const reason = detail.reason === 'late_payment_accepted' ? 'late_payment_accepted' : 'stale_release';
  const note = input.note?.trim() || null;

  // Claim the decision first (OPEN -> ACKNOWLEDGED), so two admins cannot both act.
  const claim = await prisma.pgReconException.updateMany({
    where: { id: ex.id, status: 'OPEN' },
    data: { status: 'ACKNOWLEDGED', resolution: `${input.decision === 'CONFIRM' ? 'Confirming' : 'Declining'} (restaurant ${actorId})` },
  });
  if (claim.count !== 1) throw new HeldReleaseError('This order was already decided.');
  const reopen = () => prisma.pgReconException.updateMany({ where: { id: ex.id, status: 'ACKNOWLEDGED' }, data: { status: 'OPEN', resolution: null } });

  if (input.decision === 'DECLINE') {
    try {
      await transitionOrder(ex.orderId, OrderStatus.CANCELLED_BY_ADMIN, { actorId, note: `Restaurant declined the held paid order${note ? `: ${note}` : ''}` });
    } catch (e) {
      await reopen();
      throw new HeldReleaseError(`Could not cancel the order: ${(e as Error).message}`);
    }
    const refundKind = reason === 'late_payment_accepted' ? 'LATE_PAYMENT' : 'ORDER';
    await prisma.pgReconException.update({
      where: { id: ex.id },
      data: { resolution: `Restaurant declined${note ? ` (${note})` : ''}; refund the customer (${refundKind} refund).` },
    });
    await appendDecisionEvent(ex, actorId, 'RELEASE_HELD_DECLINED', { reason, note, refundKind });
    return { exceptionId: ex.id, orderId: ex.orderId, decision: 'DECLINED', reason, outcome: 'CANCELLED' };
  }

  if (reason === 'late_payment_accepted') {
    if (!ex.bankTransactionId || typeof detail.proposalId !== 'string' || typeof detail.requestedById !== 'string' || typeof detail.approvedById !== 'string') {
      await reopen();
      throw new HeldReleaseError('The late-payment approval record is incomplete; ask operations to re-approve.');
    }
    const { allocateBankCredit } = await import('./reconcile-engine');
    try {
      const r = await allocateBankCredit({
        attemptId: ex.attemptId,
        bankTransactionId: ex.bankTransactionId,
        acceptLate: {
          proposalId: detail.proposalId,
          requestedById: detail.requestedById,
          approvedById: detail.approvedById,
          restaurantConfirmedById: actorId,
          heldExceptionId: ex.id,
        },
      });
      await appendDecisionEvent(ex, actorId, 'RELEASE_HELD_CONFIRMED', { reason, note, allocationId: r.allocationId ?? null });
      return { exceptionId: ex.id, orderId: ex.orderId, decision: 'CONFIRMED', reason, outcome: r.outcome };
    } catch (e) {
      await reopen();
      throw new HeldReleaseError((e as Error).message);
    }
  }

  // stale_release: money is already captured; release now without auto-accept.
  const attempt = await prisma.pgPaymentAttempt.findUnique({ where: { id: ex.attemptId }, select: { state: true, payment: { select: { status: true } } } });
  const order = await prisma.order.findUnique({ where: { id: ex.orderId }, select: { status: true } });
  if (attempt?.state !== PgAttemptState.CAPTURED || attempt.payment.status !== PaymentStatus.CAPTURED || order?.status !== OrderStatus.PAYMENT_PENDING) {
    await reopen();
    throw new HeldReleaseError(`This order can no longer be released (order ${order?.status ?? 'missing'}, payment ${attempt?.payment.status ?? 'missing'}).`);
  }
  try {
    await transitionOrder(ex.orderId, OrderStatus.RECEIVED, { actorId, note: 'Restaurant confirmed the held paid order (Flavrly PG)', pgRelease: true });
  } catch (e) {
    await reopen();
    throw new HeldReleaseError(`Could not release the order: ${(e as Error).message}`);
  }
  await prisma.pgReconException.update({
    where: { id: ex.id },
    data: { status: 'RESOLVED', resolution: `Restaurant confirmed${note ? ` (${note})` : ''}; order released to the kitchen`, resolvedById: actorId, resolvedAt: new Date() },
  });
  await appendDecisionEvent(ex, actorId, 'RELEASE_HELD_CONFIRMED', { reason, note });
  return { exceptionId: ex.id, orderId: ex.orderId, decision: 'CONFIRMED', reason, outcome: 'RELEASED' };
}

async function appendDecisionEvent(
  ex: { id: string; restaurantId: string | null; attemptId: string | null; orderId: string | null; bankTransactionId: string | null; amountPaise: number | null },
  actorId: string,
  kind: string,
  data: Record<string, unknown>,
) {
  const { appendFinancialEvent } = await import('./ledger');
  await appendFinancialEvent(prisma, {
    kind,
    restaurantId: ex.restaurantId,
    attemptId: ex.attemptId,
    orderId: ex.orderId,
    bankTransactionId: ex.bankTransactionId,
    amountPaise: ex.amountPaise,
    actorId,
    dedupeKey: `RELEASE_HELD_DECIDED:${ex.id}`,
    data: { exceptionId: ex.id, ...data } as never,
  });
}

/** True when the order reached RECEIVED at some point (so it was released / went to the kitchen). */
async function wasEverReleased(orderId: string): Promise<boolean> {
  const ev = await prisma.orderStatusEvent.findFirst({
    where: { orderId, status: OrderStatus.RECEIVED },
    select: { id: true },
  });
  return ev !== null;
}

/** Auto-accept is best-effort exactly as on the COD/PhonePe paths; the release itself already committed. */
async function applyAutoAccept(orderId: string, restaurantId: string): Promise<void> {
  await maybeAutoAccept(orderId, restaurantId).catch((e) =>
    log.error({ err: (e as Error).message, orderId }, 'pg.release.auto_accept_failed'),
  );
}
