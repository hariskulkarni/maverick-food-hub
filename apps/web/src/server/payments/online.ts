/**
 * Online payment sessions — the one place a gateway checkout is opened.
 *
 * `placeOrder` calls this immediately after committing an order, and the
 * "retry payment" route calls it again when a customer comes back to an order
 * whose first attempt failed or expired. Keeping both on one path means the
 * merchant-order-id scheme, the Payment row shape and the metadata we send are
 * identical no matter how the session started.
 *
 * Each attempt gets its own `merchantOrderId` (`<orderId>-<n>`) because PhonePe
 * rejects a reused one with a bare BAD_REQUEST, and because a fresh id keeps the
 * webhook → Payment lookup unambiguous when a customer retries.
 */

import { prisma } from '../db';
import { log } from '../log';
import { paymentProvider, type ProviderOrder } from './index';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

/** Payment methods that open a gateway checkout rather than settling in-app. */
export const ONLINE_METHODS: PaymentMethod[] = [PaymentMethod.RAZORPAY, PaymentMethod.PHONEPE];

export function isOnlineMethod(m: PaymentMethod | string | null | undefined): boolean {
  return m === PaymentMethod.RAZORPAY || m === PaymentMethod.PHONEPE;
}

export class OnlinePaymentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface OnlinePaymentSession {
  /** Our Payment row id. */
  paymentId: string;
  providerName: string;
  /** Razorpay order id, or PhonePe merchantOrderId. Also on Payment.providerRef. */
  providerOrderId: string;
  amount: number;
  currency: string;
  /** PhonePe: PayPage token URL to open (iframe or redirect). */
  redirectUrl?: string;
  /** Razorpay: publishable key for the browser SDK. */
  publicKey?: string;
  /** PhonePe: mercury bundle matching the credential's environment. */
  checkoutScriptUrl?: string;
  env?: string;
  expireAt?: number;
}

function toSession(paymentId: string, p: ProviderOrder): OnlinePaymentSession {
  return {
    paymentId,
    providerName: p.providerName,
    providerOrderId: p.providerOrderId,
    amount: p.amount,
    currency: p.currency,
    redirectUrl: p.redirectUrl,
    publicKey: p.publicKey,
    checkoutScriptUrl: p.checkoutScriptUrl,
    env: p.env,
    expireAt: p.expireAt,
  };
}

/**
 * Open a gateway checkout for an order and record the pending Payment row.
 *
 * `amount` may be passed by the caller (placeOrder already knows the final
 * total, including dine-in deposit credits) — otherwise the order total is
 * used. Returns the data the browser needs to launch the checkout.
 */
export async function startOnlinePayment(
  orderId: string,
  opts: { method?: PaymentMethod; amount?: number; expireAfterSec?: number } = {},
): Promise<OnlinePaymentSession> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { name: true, phone: true, email: true } },
      branch: { select: { id: true, restaurantId: true } },
      payments: { select: { id: true, method: true, status: true } },
    },
  });
  if (!order) throw new OnlinePaymentError('Order not found.', 404);

  const amount = opts.amount ?? Number(order.total);
  if (!(amount > 0)) throw new OnlinePaymentError('Order total must be greater than zero.');

  // Already paid? Never open a second checkout — that is how customers get
  // double-charged.
  if (order.payments.some((p) => p.status === PaymentStatus.CAPTURED)) {
    throw new OnlinePaymentError('This order is already paid.', 409);
  }

  const provider = await paymentProvider(order.branch.restaurantId);
  const method = opts.method ?? (order.paymentMethod as PaymentMethod);

  // Attempt number = existing online payment rows + 1. Used to mint a unique
  // merchant order id per attempt.
  const attempt = order.payments.filter((p) => isOnlineMethod(p.method)).length + 1;
  const merchantOrderId = `${order.id}-${attempt}`;

  let providerOrder: ProviderOrder;
  try {
    providerOrder = await provider.createOrder({
      orderId: order.id,
      orderCode: order.code,
      amount,
      currency: order.currency || 'INR',
      customer: order.customer,
      restaurantId: order.branch.restaurantId,
      branchId: order.branch.id,
      merchantOrderId,
      expireAfterSec: opts.expireAfterSec,
    });
  } catch (e) {
    log.error({ err: (e as Error).message, orderId: order.id, provider: provider.name }, 'gateway createOrder failed');
    throw new OnlinePaymentError(
      `Could not start the payment: ${(e as Error).message}`,
      502,
    );
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: isOnlineMethod(method) ? method : PaymentMethod.RAZORPAY,
      status: PaymentStatus.PENDING,
      amount: amount as any,
      currency: order.currency || 'INR',
      providerName: providerOrder.providerName,
      providerRef: providerOrder.providerOrderId,
      providerData: {
        ...(providerOrder.raw as Record<string, unknown>),
        // Kept out of `raw` deliberately: these are ours, not the gateway's.
        _merchantOrderId: providerOrder.providerOrderId,
        _attempt: attempt,
        _gatewayOrderId: providerOrder.gatewayOrderId ?? null,
        _expireAt: providerOrder.expireAt ?? null,
      } as any,
    },
  });

  return toSession(payment.id, providerOrder);
}
