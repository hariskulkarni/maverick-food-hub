/**
 * Payment provider interface + adapter selection.
 *
 *   PAYMENT_PROVIDER=razorpay  →  real Razorpay (key/secret/webhook required)
 *   PAYMENT_PROVIDER=mock      →  local dev: auto-confirms after a 1s delay
 */

import { mockProvider } from './mock';
import { razorpayProvider } from './razorpay';
import { getConfig } from '../integrations';

export interface CreateOrderArgs {
  orderId: string;
  amount: number; // in INR (whole rupees)
  currency: string;
  customer: { name?: string | null; phone?: string | null; email?: string | null };
}

export interface ProviderOrder {
  providerName: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  publicKey?: string;
  raw: Record<string, unknown>;
}

export interface VerifyArgs {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyResult {
  ok: boolean;
  providerPaymentId?: string;
  error?: string;
}

export interface RefundArgs {
  providerPaymentId: string;
  amount: number;
  reason?: string;
}

export interface RefundResult {
  ok: boolean;
  providerRefundId?: string;
  error?: string;
}

export interface PaymentProvider {
  name: string;
  createOrder(args: CreateOrderArgs): Promise<ProviderOrder>;
  verifyPayment(args: VerifyArgs): Promise<VerifyResult>;
  refund(args: RefundArgs): Promise<RefundResult>;
}

/**
 * Resolve the payment provider for the given restaurant.
 *
 * Priority:
 *   1. Per-restaurant `IntegrationCredential` row (Razorpay) — preferred.
 *   2. Env-configured Razorpay (PAYMENT_PROVIDER=razorpay).
 *   3. Mock (auto-confirms after 1s in dev).
 */
export async function paymentProvider(restaurantId?: string): Promise<PaymentProvider> {
  if (restaurantId) {
    const cfg = await getConfig(restaurantId, 'RAZORPAY');
    if (cfg && cfg.keyId && cfg.keySecret) {
      return razorpayProvider({ keyId: cfg.keyId, keySecret: cfg.keySecret, webhookSecret: cfg.webhookSecret });
    }
  }
  const which = process.env.PAYMENT_PROVIDER || 'mock';
  if (which === 'razorpay' && process.env.RAZORPAY_KEY_ID) return razorpayProvider();
  return mockProvider();
}
