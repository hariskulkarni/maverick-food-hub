/**
 * Order refund engine.
 *
 * Platform policy (Flavrly): refunds go to the customer's WALLET by default —
 * instant, keeps money on-platform, no gateway fee. A super-admin may instead
 * choose ORIGINAL_PAYMENT to reverse the charge on the original method (gateway
 * path). The chosen destination is always recorded on the Refund row for audit.
 *
 * The amount is capped at the order total minus anything already refunded, so a
 * sequence of partial refunds can never exceed the order value.
 *
 * Money movement + the Refund record happen in a single transaction. The order
 * status is then advanced (best-effort) through the refund funnel so downstream
 * side-effects (signup-bonus restore, freebie stock restore) fire via
 * transitionOrder.
 */
import { prisma } from './db';
import { audit } from './audit';
import { transitionOrder } from './orders';
import { log } from './log';
import { getConfigInherited } from './integrations';
import { razorpayProvider } from './payments/razorpay';
import { phonepeProvider, resolvePhonePeConfig } from './payments/phonepe';
import { isWithinRefundWindow, REFUND_WINDOW_DAYS } from './payments/phonepe-events';
import { toMerchantId } from './payments/phonepe-api';
import { OrderStatus, RefundDestination } from '@prisma/client';
import { nanoid } from 'nanoid';
import { requestPgRefund, PgRefundError, walletRefundAllowed } from './pg/refunds';
import { decimalToPaise } from './pg/money';

export type RefundDest = 'WALLET' | 'ORIGINAL_PAYMENT';

export interface RefundInput {
  orderId: string;
  amount: number;
  reason?: string | null;
  destination: RefundDest;
  actorId?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
}

export interface RefundResult {
  refundId: string;
  destination: RefundDest;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  amount: number;
  walletCredited: number;
  /** Operator guidance when the refund still needs human action (Flavrly PG manual bank refund). */
  note?: string;
}

export class RefundError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * The restaurant's Razorpay credentials for the branch this order belongs to, or
 * null when none are configured (dev/mock). Failures are swallowed → mock path.
 */
async function resolveRazorpayCreds(branchId?: string | null) {
  if (!branchId) return null;
  try {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { restaurantId: true } });
    if (!branch) return null;
    const cfg = (await getConfigInherited(branch.restaurantId, 'RAZORPAY'))?.config;
    if (cfg?.keyId && cfg?.keySecret) {
      return { keyId: cfg.keyId, keySecret: cfg.keySecret, webhookSecret: cfg.webhookSecret };
    }
    return null;
  } catch {
    return null;
  }
}

/** The restaurant that owns a branch, or null. */
async function restaurantIdForBranch(branchId?: string | null): Promise<string | null> {
  if (!branchId) return null;
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { restaurantId: true } });
  return branch?.restaurantId ?? null;
}

/** Statuses from which a refund may be issued. */
const REFUNDABLE: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUND_INITIATED
];

async function refundFlavrlyPgOrder(input: RefundInput, amount: number, orderId: string): Promise<RefundResult> {
  if (input.destination === 'WALLET' && !walletRefundAllowed()) {
    throw new RefundError(
      "This order was paid by direct UPI (Flavrly PG) straight into the restaurant's bank account, so wallet credit is " +
        'disabled. Choose the original payment method to start a manual bank refund.',
      409
    );
  }
  if (!input.actorId) throw new RefundError('A signed-in admin is required to request a Flavrly PG refund.', 401);
  try {
    const v = await requestPgRefund({
      orderId,
      amountPaise: decimalToPaise(amount.toFixed(2)),
      reason: input.reason?.trim() || 'Refund requested by admin',
      actor: { id: input.actorId, role: input.actorRole },
      kind: 'ORDER',
      method: input.destination === 'WALLET' ? 'WALLET' : 'MANUAL_BANK'
    });
    return {
      refundId: v.refundId,
      destination: input.destination,
      status: 'PENDING',
      amount,
      walletCredited: 0,
      note:
        'Manual refund recorded as PENDING. Nothing has been sent yet: a second admin must approve it, the money must be ' +
        "returned from the restaurant's bank account, and the bank refund reference must then be recorded."
    };
  } catch (e) {
    if (e instanceof PgRefundError) throw new RefundError(e.message, e.status);
    throw e;
  }
}

export async function refundOrder(input: RefundInput): Promise<RefundResult> {
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new RefundError('Refund amount must be greater than zero.');

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, refunds: true }
  });
  if (!order) throw new RefundError('Order not found.', 404);

  // Flavrly PG (direct-to-merchant UPI): the money is in the restaurant's own bank
  // account and the gateway has no refund API. Never credit the wallet by default
  // or record a gateway refund; hand off to the manual two-person bank refund flow.
  // Its own pot check (bank-allocated money minus non-FAILED refunds) replaces the
  // order-total cap below. Decided by the captured payment's rail; with nothing
  // captured, any Flavrly PG attempt routes here too (and is refused unless the
  // bank-confirmed money exists) so unverified money is never wallet-credited.
  const captured = order.payments.find((p) => p.status === 'CAPTURED');
  if (captured ? captured.providerName === 'youpi' : order.payments.some((p) => p.providerName === 'youpi')) {
    return refundFlavrlyPgOrder(input, amount, order.id);
  }

  if (!REFUNDABLE.includes(order.status)) {
    throw new RefundError(`Order in status ${order.status} cannot be refunded.`);
  }

  // Cap so cumulative refunds never exceed the order total.
  const alreadyRefunded = order.refunds.reduce((s, r) => s + Number(r.amount), 0);
  const remaining = Math.round((Number(order.total) - alreadyRefunded) * 100) / 100;
  if (remaining <= 0) throw new RefundError('This order is already fully refunded.');
  if (amount > remaining) {
    throw new RefundError(`Refund exceeds the refundable balance (₹${remaining.toFixed(2)} left).`);
  }

  // The captured payment (if any) — required for ORIGINAL_PAYMENT, optional for
  // WALLET (e.g. COD orders never captured a gateway payment).
  const capturedPayment = order.payments.find((p) => p.status === 'CAPTURED') ?? null;

  let result: RefundResult;

  if (input.destination === 'WALLET') {
    const refund = await prisma.$transaction(async (tx) => {
      // H7: re-check the cap INSIDE the transaction. `remaining` above was read
      // outside any transaction and Refund has no natural unique key, so a
      // double-click could create two refunds that together exceed the order
      // total. Re-sum here (and the Serializable isolation below makes two
      // concurrent refunds conflict rather than both committing).
      const priorAgg = await tx.refund.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
      const remainingNow = Math.round((Number(order.total) - Number(priorAgg._sum.amount ?? 0)) * 100) / 100;
      if (amount > remainingNow) {
        throw new RefundError(`Refund exceeds the refundable balance (₹${remainingNow.toFixed(2)} left).`);
      }
      const wallet = await tx.wallet.upsert({
        where: { userId: order.customerId },
        update: { balance: { increment: amount as any } },
        create: { userId: order.customerId, balance: amount as any }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId: order.id,
          type: 'REFUND',
          amount: amount as any,
          note: input.reason ?? `Refund for order ${order.code ?? order.id}`
        }
      });
      return tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: capturedPayment?.id ?? null,
          amount: amount as any,
          reason: input.reason ?? null,
          destination: RefundDestination.WALLET,
          status: 'COMPLETED',
          createdById: input.actorId ?? null
        }
      });
    }, { isolationLevel: 'Serializable' });
    result = { refundId: refund.id, destination: 'WALLET', status: 'COMPLETED', amount, walletCredited: amount };
  } else {
    // ORIGINAL_PAYMENT — reverse the charge on the gateway. Requires a captured
    // payment to refund against.
    if (!capturedPayment) {
      throw new RefundError('No captured online payment to refund — use the wallet instead.');
    }
    // Real gateway refund when this is a Razorpay payment with a stored gateway
    // payment id AND the restaurant has Razorpay credentials. The refund then
    // stays PENDING until Razorpay confirms via the refund.processed webhook
    // (which flips it to COMPLETED and marks the payment REFUNDED). When no
    // credentials are configured (dev/mock), it settles immediately so the flow
    // stays end-to-end usable.
    let gatewayRefundId: string | null = null;
    let providerRefundKey: string | null = null;
    let gatewayName: string | null = null;
    // C5: the failure path is the default. Only a confirmed gateway outcome may
    // flip this true (PhonePe COMPLETED), and Razorpay stays false pending its
    // webhook. Previously this started true, so a skipped gateway block wrote a
    // COMPLETED refund with a fabricated reference and no money moved.
    let settledNow = false;

    if (capturedPayment.providerName === 'razorpay' && capturedPayment.providerRef) {
      const creds = await resolveRazorpayCreds(order.branchId);
      if (creds) {
        try {
          const provider = razorpayProvider(creds);
          const gw = await provider.refund({
            providerPaymentId: capturedPayment.providerRef,
            amount,
            reason: input.reason ?? undefined
          });
          gatewayRefundId = gw.providerRefundId ?? null;
          providerRefundKey = gatewayRefundId;
          gatewayName = 'razorpay';
          // stays PENDING (settledNow=false) — confirmed asynchronously by the webhook
        } catch (e) {
          throw new RefundError(`Gateway refund failed: ${(e as Error).message}`, 502);
        }
      }
    } else if (capturedPayment.providerName === 'phonepe' && capturedPayment.providerRef) {
      // PhonePe hard-caps refunds at 3 months from the original transaction.
      // Fail here with a clear message rather than eating a
      // REFUND_FOR_TXN_OLDER_THAN_LIMIT round-trip.
      if (!isWithinRefundWindow(capturedPayment.updatedAt ?? capturedPayment.createdAt)) {
        throw new RefundError(
          `PhonePe only accepts refunds within ${REFUND_WINDOW_DAYS} days of the payment. Refund to the customer's wallet instead.`
        );
      }
      const cfg = await resolvePhonePeConfig(await restaurantIdForBranch(order.branchId));
      if (cfg) {
        // PhonePe keys refunds on a merchant-generated id, and treats a repeat
        // of the same id as the same refund — so this doubles as our
        // idempotency key. Minted before the call and stored on providerRef so
        // a crash mid-flight is recoverable by the reconciler.
        const merchantRefundId = toMerchantId(`rfnd-${nanoid(16)}`);
        try {
          const provider = phonepeProvider(cfg);
          const gw = await provider.refund({
            originalMerchantOrderId: capturedPayment.providerRef,
            merchantRefundId,
            amount,
            reason: input.reason ?? undefined
          });
          if (!gw.ok) throw new Error(gw.error || 'PhonePe rejected the refund');
          providerRefundKey = merchantRefundId;
          gatewayRefundId = gw.gatewayRefundId ?? null;
          gatewayName = 'phonepe';
          // PhonePe refunds start PENDING and settle asynchronously; the
          // pg.refund.completed webhook (or the sweeper) flips them.
          settledNow = gw.status === 'COMPLETED';
        } catch (e) {
          throw new RefundError(`Gateway refund failed: ${(e as Error).message}`, 502);
        }
      }
    }

    // C5: never record a COMPLETED refund when no real gateway was reached. If no
    // gateway block ran (unknown provider, or credentials that could not be
    // resolved/decrypted), refuse in production rather than fabricating a
    // COMPLETED mock refund. Dev and genuine mock payments keep immediate settle.
    if (!gatewayName) {
      const isMockPayment = !capturedPayment.providerName || capturedPayment.providerName === 'mock';
      if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true' && !isMockPayment) {
        throw new RefundError(
          `Cannot refund the ${capturedPayment.providerName} payment for order ${order.id}: ` +
            `no gateway credentials could be resolved, so the refund was NOT recorded. ` +
            `Configure the gateway credentials, or refund to the customer's wallet instead.`,
          502
        );
      }
      // Dev / mock: immediate settlement is fine.
      settledNow = true;
    }

    const providerRef = providerRefundKey ?? `rfnd_${Math.random().toString(36).slice(2, 12)}`;
    const refund = await prisma.$transaction(async (tx) => {
      // H7: re-check the cap inside the transaction (see WALLET path).
      const priorAgg = await tx.refund.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
      const remainingNow = Math.round((Number(order.total) - Number(priorAgg._sum.amount ?? 0)) * 100) / 100;
      if (amount > remainingNow) {
        throw new RefundError(`Refund exceeds the refundable balance (₹${remainingNow.toFixed(2)} left).`);
      }
      const r = await tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: capturedPayment.id,
          amount: amount as any,
          reason: input.reason ?? null,
          destination: RefundDestination.ORIGINAL_PAYMENT,
          status: settledNow ? 'COMPLETED' : 'PENDING',
          providerRef,
          providerData: gatewayName
            ? { provider: gatewayName, gatewayRefundId, merchantRefundId: providerRef, pending: !settledNow }
            : { provider: capturedPayment.providerName ?? 'mock', mock: true },
          createdById: input.actorId ?? null
        }
      });
      // Only mark the payment REFUNDED once actually settled (mock path). A real
      // gateway refund waits for the webhook to confirm before flipping status.
      if (settledNow && amount >= remainingNow) {
        await tx.payment.update({ where: { id: capturedPayment.id }, data: { status: 'REFUNDED' } });
      }
      return r;
    }, { isolationLevel: 'Serializable' });
    result = {
      refundId: refund.id,
      destination: 'ORIGINAL_PAYMENT',
      status: settledNow ? 'COMPLETED' : 'PENDING',
      amount,
      walletCredited: 0
    };
  }

  // Advance the order through the refund funnel (best-effort). A full refund
  // settles to REFUNDED; a partial refund parks at REFUND_INITIATED so the order
  // stays visibly "refund in progress". Failures here never undo the refund —
  // the Refund row + money movement above are the source of truth.
  const fullRefund = amount >= remaining;
  // Settle to REFUNDED only when the refund is actually COMPLETED and full. A
  // PENDING gateway refund parks at REFUND_INITIATED until the webhook confirms.
  const settleToRefunded = fullRefund && result.status === 'COMPLETED';
  try {
    const alreadyInFunnel: OrderStatus[] = [OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED];
    if (!alreadyInFunnel.includes(order.status)) {
      await transitionOrder(order.id, OrderStatus.REFUND_PENDING, { actorId: input.actorId ?? undefined, note: input.reason ?? undefined });
    }
    await transitionOrder(order.id, settleToRefunded ? OrderStatus.REFUNDED : OrderStatus.REFUND_INITIATED, {
      actorId: input.actorId ?? undefined,
      note: input.reason ?? undefined
    });
  } catch (e) {
    log.error({ err: (e as Error).message, orderId: order.id }, 'refund: order status advance failed (refund itself succeeded)');
  }

  await audit('order.refund', {
    actorId: input.actorId,
    actorRole: input.actorRole,
    entityType: 'Order',
    entityId: order.id,
    after: { refundId: result.refundId, amount, destination: result.destination, status: result.status, fullRefund },
    ipAddress: input.ipAddress
  }).catch(() => {});

  return result;
}
