/**
 * PhonePe adapter — implements the platform `PaymentProvider` seam on top of
 * `phonepe-api.ts`.
 *
 * Shape differences from Razorpay worth knowing when reading the rest of the
 * payment code:
 *
 *  • PhonePe is *redirect-first*. `createOrder` returns a `redirectUrl` (a
 *    PayPage token URL) that the browser opens, either in PhonePe's iframe via
 *    mercury's checkout.js or as a full-page navigation. There is no publishable
 *    key and no client-side order object.
 *
 *  • There is no client-returned signature to verify. Razorpay hands the browser
 *    an `order|payment` HMAC; PhonePe hands back nothing trustworthy. So
 *    `verifyPayment` ignores anything the client says and asks the Order Status
 *    API directly — the browser cannot forge a capture.
 *
 *  • Refunds are keyed by a merchant-generated `merchantRefundId` against the
 *    original `merchantOrderId`, not against a gateway payment id.
 */

import type { PaymentProvider, CreateOrderArgs, VerifyArgs, RefundArgs } from './index';
import {
  type PhonePeConfig,
  type PhonePeEnv,
  createPayment,
  createRefund,
  getOrderStatus,
  getRefundStatus,
  phonePeCheckoutScriptUrl,
  toMerchantId,
  toPaisa,
  PhonePeError,
} from './phonepe-api';
import { paymentStatusFromPhonePe, phonePeErrorMessage, toPhonePeState } from './phonepe-events';
import { getConfigInherited } from '../integrations';
import { brand } from '@/lib/brand';

export const PHONEPE_PROVIDER_NAME = 'phonepe';

/**
 * How long a PayPage stays open. 15 minutes is comfortably inside PhonePe's
 * 300–3600s band and long enough for a UPI collect request to be approved in
 * another app without stranding stock in a pending order for an hour.
 */
const DEFAULT_EXPIRE_AFTER_SEC = 15 * 60;

// ─── Credential resolution ──────────────────────────────────────────────────

function envConfig(): PhonePeConfig | null {
  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
    env: (process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
    webhookUsername: process.env.PHONEPE_WEBHOOK_USERNAME || undefined,
    webhookPassword: process.env.PHONEPE_WEBHOOK_PASSWORD || undefined,
  };
}

/** Coerce a stored credential blob into a PhonePeConfig, or null if incomplete. */
export function phonePeConfigFromStored(c: Record<string, string> | null | undefined): PhonePeConfig | null {
  if (!c?.clientId || !c?.clientSecret) return null;
  return {
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    clientVersion: c.clientVersion || '1',
    env: (c.env || 'SANDBOX').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
    webhookUsername: c.webhookUsername || undefined,
    webhookPassword: c.webhookPassword || undefined,
  };
}

/**
 * PhonePe credentials for a restaurant.
 *
 * Precedence:
 *   1. the restaurant's own stored credentials
 *   2. an ancestor's, for a child outlet in a group (see getConfigInherited) —
 *      one merchant account for the whole brand, settling to the parent's bank
 *   3. the platform env pair
 *
 * Mirrors the precedence the Razorpay path already uses, so a tenant that has
 * not onboarded its own merchant account still transacts through the platform
 * account when one is configured.
 */
export async function resolvePhonePeConfig(restaurantId?: string | null): Promise<PhonePeConfig | null> {
  if (restaurantId) {
    try {
      const found = await getConfigInherited(restaurantId, 'PHONEPE');
      const stored = phonePeConfigFromStored(found?.config ?? null);
      if (stored) return stored;
    } catch {
      // Fall through to env — a decrypt/DB hiccup must not take checkout down.
    }
  }
  return envConfig();
}

// ─── Redirect target ────────────────────────────────────────────────────────

/**
 * Where PhonePe sends the customer once the PayPage concludes.
 *
 * Uses the canonical brand URL rather than NEXTAUTH_URL: on our VPS the latter
 * is sometimes a bare http IP, and PhonePe rejects non-HTTPS return URLs (and
 * will hard-fail with INTERNAL_SECURITY_BLOCK_1 if the host is not the domain
 * onboarded on the dashboard).
 */
export function phonePeRedirectUrl(merchantOrderId: string, base = brand.url): string {
  const root = (base || '').replace(/\/+$/, '');
  return `${root}/api/payments/phonepe/return?ref=${encodeURIComponent(merchantOrderId)}`;
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export function phonepeProvider(cfg: PhonePeConfig): PaymentProvider {
  return {
    name: PHONEPE_PROVIDER_NAME,

    async createOrder(args: CreateOrderArgs) {
      // The merchant order id is the join key for everything downstream — the
      // webhook, the status poll and the refund all address the order by it — so
      // it is stored verbatim on Payment.providerRef.
      const merchantOrderId = toMerchantId(args.merchantOrderId ?? args.orderId);
      const redirectUrl = args.redirectUrl ?? phonePeRedirectUrl(merchantOrderId);

      const res = await createPayment(cfg, {
        merchantOrderId,
        amountPaisa: toPaisa(args.amount),
        redirectUrl,
        expireAfter: args.expireAfterSec ?? DEFAULT_EXPIRE_AFTER_SEC,
        message: args.description ?? `Order ${args.orderCode ?? args.orderId}`,
        // Pre-fills the mobile on the PayPage — one fewer field for the
        // customer. Dropped silently if it isn't a valid Indian mobile.
        customerPhone: args.customer.phone,
        // udf1..udf5 come back on both the status response and every webhook,
        // which makes them the cheapest way to re-associate an event with our
        // rows even if the merchant order id were ever ambiguous.
        metaInfo: {
          udf1: args.orderId,
          udf2: args.orderCode ?? '',
          udf3: args.restaurantId ?? '',
          udf4: args.branchId ?? '',
          udf5: args.customer.phone ?? '',
        },
      });

      return {
        providerName: PHONEPE_PROVIDER_NAME,
        providerOrderId: merchantOrderId,
        amount: args.amount,
        currency: args.currency,
        redirectUrl: res.redirectUrl,
        gatewayOrderId: res.orderId,
        expireAt: res.expireAt,
        checkoutScriptUrl: phonePeCheckoutScriptUrl(cfg.env),
        env: cfg.env,
        raw: res.raw,
      };
    },

    /**
     * Confirm a payment. The client's claims are ignored entirely — we ask
     * PhonePe. `providerOrderId` is our merchantOrderId.
     */
    async verifyPayment(args: VerifyArgs) {
      const merchantOrderId = args.merchantOrderId ?? args.providerOrderId;
      if (!merchantOrderId) return { ok: false, error: 'Missing merchant order id' };

      try {
        const status = await getOrderStatus(cfg, merchantOrderId);
        const state = toPhonePeState(status.state);
        const mapped = paymentStatusFromPhonePe(state);

        if (mapped === 'CAPTURED') {
          const attempt = (status.paymentDetails ?? []).find((d) => toPhonePeState(d.state) === 'COMPLETED');
          return {
            ok: true,
            status: 'CAPTURED',
            providerPaymentId: attempt?.transactionId ?? status.orderId ?? merchantOrderId,
            amount: typeof status.amount === 'number' ? status.amount / 100 : undefined,
            paymentMode: attempt?.paymentMode,
            raw: status.raw,
          };
        }
        if (mapped === 'PENDING') {
          return { ok: false, status: 'PENDING', error: 'Payment is still pending', raw: status.raw };
        }
        return {
          ok: false,
          status: 'FAILED',
          error: phonePeErrorMessage(status.errorCode, status.detailedErrorCode),
          errorCode: status.detailedErrorCode ?? status.errorCode ?? undefined,
          raw: status.raw,
        };
      } catch (e) {
        const err = e as PhonePeError;
        // A transport failure is *not* a payment failure. Report it as
        // indeterminate so callers leave the payment PENDING for the
        // reconciler rather than marking a possibly-captured order FAILED.
        return { ok: false, status: 'UNKNOWN', error: err.message, errorCode: err.code };
      }
    },

    async refund(args: RefundArgs) {
      const originalMerchantOrderId = args.originalMerchantOrderId ?? args.providerPaymentId;
      if (!originalMerchantOrderId) return { ok: false, error: 'Missing original merchant order id' };
      const merchantRefundId = toMerchantId(args.merchantRefundId ?? `rfnd-${Date.now()}`);

      try {
        const res = await createRefund(cfg, {
          merchantRefundId,
          originalMerchantOrderId,
          amountPaisa: toPaisa(args.amount),
        });
        return {
          ok: true,
          providerRefundId: merchantRefundId,
          gatewayRefundId: res.refundId,
          status: toPhonePeState(res.state) ?? 'PENDING',
          raw: res.raw,
        };
      } catch (e) {
        const err = e as PhonePeError;
        return { ok: false, error: err.message, errorCode: err.code };
      }
    },
  };
}

/** Refund state lookup, used by the reconciler for refunds still in flight. */
export async function phonepeRefundStatus(cfg: PhonePeConfig, merchantRefundId: string) {
  return getRefundStatus(cfg, merchantRefundId);
}

export type { PhonePeConfig, PhonePeEnv };
