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
}

export type OrderReleaseResult =
  | { outcome: 'RELEASED'; orderId: string }
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
  const { orderId, attemptId, paymentId } = payload ?? ({} as OrderReleasePayload);
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
      select: { status: true, branch: { select: { restaurantId: true } } },
    });
    if (!order) throw new Error(`ORDER_RELEASE: order ${orderId} not found`);

    if (order.status === OrderStatus.PAYMENT_PENDING) {
      try {
        await transitionOrder(orderId, OrderStatus.RECEIVED, {
          note: 'Payment bank-verified (Flavrly PG)',
          pgRelease: true,
        });
      } catch (e) {
        if (e instanceof OrderTransitionError && pass === 0) continue; // re-read and classify
        throw e;
      }
      await applyAutoAccept(orderId, order.branch.restaurantId);
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
    if (order.status === OrderStatus.RECEIVED) await applyAutoAccept(orderId, order.branch.restaurantId);
    return { outcome: 'ALREADY_RELEASED', orderId, orderStatus: order.status };
  }
  throw new Error(`ORDER_RELEASE: order ${orderId} kept changing concurrently`);
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
