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
import { getConfig } from './integrations';
import { razorpayProvider } from './payments/razorpay';
import { OrderStatus, RefundDestination } from '@prisma/client';

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
    const cfg = await getConfig(branch.restaurantId, 'RAZORPAY');
    if (cfg?.keyId && cfg?.keySecret) {
      return { keyId: cfg.keyId, keySecret: cfg.keySecret, webhookSecret: cfg.webhookSecret };
    }
    return null;
  } catch {
    return null;
  }
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

export async function refundOrder(input: RefundInput): Promise<RefundResult> {
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new RefundError('Refund amount must be greater than zero.');

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, refunds: true }
  });
  if (!order) throw new RefundError('Order not found.', 404);

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
    });
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
    let settledNow = true;
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
          settledNow = false; // confirmed asynchronously by the webhook
        } catch (e) {
          throw new RefundError(`Gateway refund failed: ${(e as Error).message}`, 502);
        }
      }
    }

    const providerRef = gatewayRefundId ?? `rfnd_${Math.random().toString(36).slice(2, 12)}`;
    const refund = await prisma.$transaction(async (tx) => {
      const r = await tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: capturedPayment.id,
          amount: amount as any,
          reason: input.reason ?? null,
          destination: RefundDestination.ORIGINAL_PAYMENT,
          status: settledNow ? 'COMPLETED' : 'PENDING',
          providerRef,
          providerData: gatewayRefundId
            ? { provider: 'razorpay', gatewayRefundId, pending: true }
            : { provider: capturedPayment.providerName ?? 'mock', mock: true },
          createdById: input.actorId ?? null
        }
      });
      // Only mark the payment REFUNDED once actually settled (mock path). A real
      // gateway refund waits for the webhook to confirm before flipping status.
      if (settledNow && amount >= remaining) {
        await tx.payment.update({ where: { id: capturedPayment.id }, data: { status: 'REFUNDED' } });
      }
      return r;
    });
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
