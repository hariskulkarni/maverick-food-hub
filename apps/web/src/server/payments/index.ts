/**
 * Payment provider interface + adapter selection.
 *
 * Two live gateways plus a dev stub, chosen per restaurant:
 *
 *   IntegrationCredential(RAZORPAY)  →  Razorpay        (popup checkout, HMAC verify)
 *   IntegrationCredential(PHONEPE)   →  PhonePe V2      (iframe/redirect PayPage, status-API verify)
 *   PAYMENT_PROVIDER=razorpay|phonepe →  platform-wide env fallback
 *   otherwise                        →  mock (auto-confirms, local dev)
 *
 * The interface below is the union of what both gateways need. Fields that only
 * one of them populates are optional and documented as such — Razorpay has no
 * `redirectUrl`, PhonePe has no `publicKey` or client-side `signature`.
 */

import { mockProvider } from './mock';
import { razorpayProvider } from './razorpay';
import { phonepeProvider, resolvePhonePeConfig, PHONEPE_PROVIDER_NAME } from './phonepe';
import { getConfigInherited } from '../integrations';

/** Gateways that take money online (as opposed to COD/wallet settlement). */
export type GatewayKey = 'RAZORPAY' | 'PHONEPE';

export interface CreateOrderArgs {
  /** Our internal Order.id. */
  orderId: string;
  /** Human order code (ORD-AB12CD), used in the PayPage message. */
  orderCode?: string | null;
  /** In INR (whole rupees, may carry paise as decimals). */
  amount: number;
  currency: string;
  customer: { name?: string | null; phone?: string | null; email?: string | null };
  restaurantId?: string | null;
  branchId?: string | null;
  /** PhonePe: overrides the generated merchant order id (retry attempts). */
  merchantOrderId?: string;
  /** PhonePe: where the customer returns after the PayPage concludes. */
  redirectUrl?: string;
  /** PhonePe: seconds before the checkout expires (clamped to 300–3600). */
  expireAfterSec?: number;
  description?: string;
}

export interface ProviderOrder {
  providerName: string;
  /**
   * The id we persist on `Payment.providerRef` and use to look the payment back
   * up from a webhook. Razorpay: the gateway order id. PhonePe: our own
   * merchantOrderId (which is what its webhooks and status API echo).
   */
  providerOrderId: string;
  amount: number;
  currency: string;
  /** Razorpay: publishable key for the browser SDK. */
  publicKey?: string;
  /** PhonePe: the PayPage token URL to open. */
  redirectUrl?: string;
  /** PhonePe: its own internal order id (OMO…), informational. */
  gatewayOrderId?: string;
  /** PhonePe: epoch ms when the checkout expires. */
  expireAt?: number;
  /** PhonePe: mercury checkout.js bundle for the iframe PayPage. */
  checkoutScriptUrl?: string;
  /** PhonePe: SANDBOX | PRODUCTION, so the client loads the matching bundle. */
  env?: string;
  raw: Record<string, unknown>;
}

export interface VerifyArgs {
  /** Razorpay: gateway order id. PhonePe: merchantOrderId (see merchantOrderId). */
  providerOrderId?: string;
  /** Razorpay only. */
  providerPaymentId?: string;
  /** Razorpay only — PhonePe returns nothing signable to the browser. */
  signature?: string;
  /** PhonePe: explicit merchant order id. */
  merchantOrderId?: string;
}

/**
 * `UNKNOWN` matters: it distinguishes "the gateway says this failed" from "we
 * could not reach the gateway". Only the former may mark a payment FAILED.
 */
export type VerifyStatus = 'CAPTURED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export interface VerifyResult {
  ok: boolean;
  status?: VerifyStatus;
  providerPaymentId?: string;
  amount?: number;
  paymentMode?: string;
  error?: string;
  errorCode?: string;
  raw?: Record<string, unknown>;
}

export interface RefundArgs {
  /** Razorpay: the gateway payment id to reverse. */
  providerPaymentId?: string;
  /** PhonePe: the original merchantOrderId that was charged. */
  originalMerchantOrderId?: string;
  /** PhonePe: our idempotency key for this refund. */
  merchantRefundId?: string;
  amount: number;
  reason?: string;
}

export interface RefundResult {
  ok: boolean;
  /** The id we store on Refund.providerRef and query status by. */
  providerRefundId?: string;
  /** PhonePe's own refund id (OMR…), informational. */
  gatewayRefundId?: string;
  status?: 'PENDING' | 'COMPLETED' | 'FAILED';
  error?: string;
  errorCode?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;
  createOrder(args: CreateOrderArgs): Promise<ProviderOrder>;
  verifyPayment(args: VerifyArgs): Promise<VerifyResult>;
  refund(args: RefundArgs): Promise<RefundResult>;
}

/**
 * Which gateway is configured for a restaurant, without building the adapter.
 *
 * Order of preference when a tenant has connected both: PhonePe first. It is
 * the India-first rail (UPI intent + QR, lower MDR on UPI) and a restaurant that
 * has gone to the trouble of onboarding a PhonePe merchant account has signalled
 * that intent. A tenant on Razorpay only is unaffected.
 */
export async function resolveGatewayKey(restaurantId?: string | null): Promise<GatewayKey | null> {
  if (restaurantId) {
    // Inherited lookups so a child outlet in a restaurant group routes through
    // the parent brand's gateway without being connected individually.
    try {
      const pp = (await getConfigInherited(restaurantId, 'PHONEPE'))?.config;
      if (pp?.clientId && pp?.clientSecret) return 'PHONEPE';
    } catch {
      /* fall through */
    }
    try {
      const rp = (await getConfigInherited(restaurantId, 'RAZORPAY'))?.config;
      if (rp?.keyId && rp?.keySecret) return 'RAZORPAY';
    } catch {
      /* fall through */
    }
  }
  const which = (process.env.PAYMENT_PROVIDER || '').toLowerCase();
  if (which === 'phonepe' && process.env.PHONEPE_CLIENT_ID) return 'PHONEPE';
  if (which === 'razorpay' && process.env.RAZORPAY_KEY_ID) return 'RAZORPAY';
  return null;
}

/**
 * Resolve the payment provider for the given restaurant.
 *
 * Priority:
 *   1. Per-restaurant `IntegrationCredential` (PhonePe, then Razorpay).
 *   2. Env-configured gateway (PAYMENT_PROVIDER).
 *   3. Mock (auto-confirms, dev only).
 */
export async function paymentProvider(restaurantId?: string | null): Promise<PaymentProvider> {
  const key = await resolveGatewayKey(restaurantId);

  if (key === 'PHONEPE') {
    const cfg = await resolvePhonePeConfig(restaurantId);
    if (cfg) return phonepeProvider(cfg);
  }

  if (key === 'RAZORPAY') {
    if (restaurantId) {
      const cfg = (await getConfigInherited(restaurantId, 'RAZORPAY'))?.config;
      if (cfg?.keyId && cfg?.keySecret) {
        return razorpayProvider({ keyId: cfg.keyId, keySecret: cfg.keySecret, webhookSecret: cfg.webhookSecret });
      }
    }
    if (process.env.RAZORPAY_KEY_ID) return razorpayProvider();
  }

  return mockProvider();
}

/** True when a stored `Payment.providerName` denotes the PhonePe rail. */
export function isPhonePePayment(providerName?: string | null): boolean {
  return providerName === PHONEPE_PROVIDER_NAME;
}

export { PHONEPE_PROVIDER_NAME };
