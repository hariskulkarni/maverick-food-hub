/**
 * YouPI adapter — implements the platform `PaymentProvider` seam on top of
 * `youpi-api.ts`, gated per restaurant by an APPROVED `YoupiFeatureRequest`.
 *
 * `verifyPayment` only maps the gateway status; it never marks anything paid.
 * Only reconcile / webhook flip the order.
 */

import type { PaymentProvider, CreateOrderArgs, ProviderOrder, VerifyArgs, VerifyResult, RefundResult } from './index';
import { createYoupiPayment, getYoupiStatus, type YoupiConfig } from './youpi-api';
import { assertUnderCap } from './youpi-caps';
import { getConfig } from '../integrations';
import { prisma } from '../db';

export const YOUPI_PROVIDER_NAME = 'youpi';

/** Sentinel restaurantId for platform-level IntegrationCredential rows. */
const PLATFORM_ID = '__platform__';
const YOUPI_KEY = 'YOUPI' as const;

/** Conservative pilot ceilings used when the platform sets none. */
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_MAX_AMOUNT_PAISE = 500000; // Rs 5,000

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Effective config, only when (a) the restaurant's YoupiFeatureRequest is
 * APPROVED, (b) the platform connection exists, and (c) the restaurant has a
 * receiving VPA. Per-restaurant caps override platform caps.
 */
export async function resolveYoupiConfig(restaurantId?: string | null): Promise<YoupiConfig | null> {
  if (!restaurantId) return null;
  try {
    const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId } });
    if (!fr || fr.status !== 'APPROVED') return null;

    const platform = await getConfig(PLATFORM_ID, YOUPI_KEY);
    if (!platform?.baseUrl || !platform?.apiKey) return null;

    const rest = await getConfig(restaurantId, YOUPI_KEY);
    if (!rest?.receivingVpa) return null;

    return {
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey,
      webhookSecret: platform.webhookSecret || undefined,
      receivingVpa: rest.receivingVpa,
      // Caps only tighten: a restaurant may lower, never raise, platform limits.
      dailyLimit: Math.min(num(platform.dailyLimit) ?? DEFAULT_DAILY_LIMIT, num(rest.dailyLimit) ?? Infinity),
      maxAmountPaise: Math.min(
        num(platform.maxAmountPaise) ?? DEFAULT_MAX_AMOUNT_PAISE,
        num(rest.maxAmountPaise) ?? Infinity,
      ),
    };
  } catch {
    // Fail closed: any lookup/decrypt error means YouPI is not available.
    return null;
  }
}

// Only construct via paymentProvider()/resolveYoupiConfig() (the config gate), never directly with an arbitrary cfg.
export function youpiProvider(cfg: YoupiConfig): PaymentProvider {
  return {
    name: YOUPI_PROVIDER_NAME,

    async createOrder(args: CreateOrderArgs): Promise<ProviderOrder> {
      if (typeof args.amount !== 'number' || !Number.isFinite(args.amount) || args.amount <= 0) {
        throw new Error('YouPI: amount must be a positive finite number');
      }
      const amountPaise = Math.round(args.amount * 100);
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error('YouPI: amount must be a positive finite number');
      }
      if (!args.restaurantId) throw new Error('YouPI: restaurantId is required');

      // Caps first: reserves a daily slot / enforces the per-payment max.
      await assertUnderCap(args.restaurantId, amountPaise, cfg);

      const { paymentId, checkoutUrl } = await createYoupiPayment(cfg, {
        orderId: args.orderId,
        amountPaise,
        customer: args.customer,
        redirectUrl: args.redirectUrl,
      });
      return {
        providerName: YOUPI_PROVIDER_NAME,
        providerOrderId: paymentId,
        redirectUrl: checkoutUrl,
        amount: args.amount,
        currency: args.currency,
        raw: { paymentId, checkoutUrl },
      };
    },

    async verifyPayment(args: VerifyArgs): Promise<VerifyResult> {
      const id = args.providerOrderId ?? args.merchantOrderId;
      if (!id) return { ok: false, status: 'UNKNOWN', error: 'Missing YouPI payment id' };
      const r = await getYoupiStatus(cfg, id);
      return {
        ok: r.status === 'CAPTURED',
        status: r.status,
        amount: typeof r.amountPaise === 'number' ? r.amountPaise / 100 : undefined,
        raw: { utr: r.utr ?? null },
      };
    },

    async refund(): Promise<RefundResult> {
      return { ok: false, status: 'FAILED', error: 'YouPI refunds are not supported in the pilot' };
    },
  };
}
