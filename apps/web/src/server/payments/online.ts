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
import { paymentProvider, youpiEnabledForRestaurant, type ProviderOrder } from './index';
import { brand } from '@/lib/brand';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { createPgAttempt, PgAttemptError } from '../pg/attempts';
import { decimalToPaise } from '../pg/money';

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
  opts: {
    method?: PaymentMethod;
    amount?: number;
    expireAfterSec?: number;
    /**
     * 'youpi' opts this attempt into the Flavrly PG rail (experimental, per-restaurant
     * APPROVED). Omitted = the restaurant's normal gateway, exactly as before.
     * The Payment stays PENDING; only reconcile/webhook may capture it.
     */
    rail?: 'youpi';
  } = {},
): Promise<OnlinePaymentSession> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { name: true, phone: true, email: true } },
      branch: { select: { id: true, restaurantId: true } },
      payments: { select: { id: true, method: true, status: true, providerName: true } },
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

  // A retry of an order whose earlier attempt was Flavrly PG stays on Flavrly PG.
  // Flavrly PG never supersedes or re-mints blindly: createPgAttempt decides (contract D8).
  if (opts.rail === 'youpi' || order.payments.some((p) => p.providerName === 'youpi')) {
    return startYoupiSession(order, opts);
  }

  // C7: mark any prior non-terminal online attempt as superseded before minting
  // a new PayPage. This is informational — a late capture on an abandoned
  // attempt is still caught by the reconciler's order-level over-collection
  // guard — but it leaves an operator-visible marker and does not clobber the
  // row's providerData (errorMessage is a plain column).
  const stale = order.payments.filter((p) => isOnlineMethod(p.method) && p.status === PaymentStatus.PENDING);
  if (stale.length > 0) {
    await prisma.payment.updateMany({
      where: { id: { in: stale.map((p) => p.id) }, status: PaymentStatus.PENDING },
      data: { errorMessage: 'Superseded by a newer payment attempt on this order.' },
    });
  }

  const provider = await paymentProvider(order.branch.restaurantId);
  const method = opts.method ?? (order.paymentMethod as PaymentMethod);

  // Attempt number = existing online payment rows + 1. Used to mint a unique
  // merchant order id per attempt.
  const attempt = order.payments.filter((p) => isOnlineMethod(p.method)).length + 1;
  const merchantOrderId = `${order.id}-${attempt}`;

  // H13: create the local Payment row BEFORE calling the gateway. Previously the
  // gateway order was minted first; if the row insert failed or the process died
  // in between, the customer had a live PayPage they could pay with no record
  // anywhere, and the webhook/sweeper had nothing to attach to. providerRef is
  // seeded with merchantOrderId (locatable on a crash) and filled with the real
  // gateway ref after createOrder succeeds; a gateway failure marks the row FAILED.
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: isOnlineMethod(method) ? method : PaymentMethod.RAZORPAY,
      status: PaymentStatus.PENDING,
      amount: amount as any,
      currency: order.currency || 'INR',
      providerName: provider.name,
      providerRef: merchantOrderId,
      providerData: { _merchantOrderId: merchantOrderId, _attempt: attempt } as any,
    },
  });

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
    await prisma.payment
      .update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, errorMessage: (e as Error).message } })
      .catch(() => {});
    throw new OnlinePaymentError(
      `Could not start the payment: ${(e as Error).message}`,
      502,
    );
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
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

/**
 * Flavrly PG rail: attempt identity, limits, receiver readback and unknown-outcome handling
 * live in createPgAttempt (pg/attempts.ts). The Payment stays PENDING; only the
 * reconciliation engine's allocateBankCredit() may capture it (contract D3).
 */
async function startYoupiSession(
  order: {
    id: string;
    customerId: string;
    total: unknown;
    currency: string | null;
    paymentMethod: PaymentMethod | string;
    customer: { name: string | null; phone: string | null };
    branch: { restaurantId: string };
  },
  opts: { method?: PaymentMethod; amount?: number },
): Promise<OnlinePaymentSession> {
  // Fail loud rather than silently routing a Flavrly PG request to another gateway.
  if (!(await youpiEnabledForRestaurant(order.branch.restaurantId))) {
    throw new OnlinePaymentError('Flavrly PG is not available for this restaurant.', 400);
  }
  if (!brand.url) {
    throw new OnlinePaymentError('Flavrly PG return URL is not configured (brand.url missing)', 500);
  }
  let amountPaise: number;
  try {
    amountPaise = decimalToPaise((opts.amount ?? order.total) as string | number);
  } catch {
    throw new OnlinePaymentError('Order total is not a valid INR amount.', 400);
  }
  const method = opts.method ?? (order.paymentMethod as PaymentMethod);
  try {
    const s = await createPgAttempt(
      { id: order.id, restaurantId: order.branch.restaurantId, customerId: order.customerId, customer: order.customer },
      {
        amountPaise,
        method: isOnlineMethod(method) ? method : PaymentMethod.RAZORPAY,
        currency: order.currency || 'INR',
        // Flavrly PG sends the customer back here; the page only polls, never trusts the return.
        redirectUrl: `${brand.url.replace(/\/+$/, '')}/checkout/payment-status?orderId=${encodeURIComponent(order.id)}&provider=youpi`,
      },
    );
    return {
      paymentId: s.paymentId,
      providerName: 'youpi',
      providerOrderId: s.gatewayPaymentId,
      amount: s.amountPaise / 100,
      currency: 'INR',
      redirectUrl: s.checkoutUrl,
      expireAt: s.expiresAt.getTime(),
    };
  } catch (e) {
    if (e instanceof PgAttemptError) {
      log.warn({ orderId: order.id, code: e.code }, 'youpi.start_failed');
      throw new OnlinePaymentError(e.message, e.status);
    }
    throw e;
  }
}
