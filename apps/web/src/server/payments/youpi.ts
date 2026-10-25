/**
 * Flavrly PG adapter — implements the platform `PaymentProvider` seam on top of
 * `youpi-api.ts`, gated per restaurant by the merchant binding (pg/merchant-binding.ts).
 *
 * Sessions are opened ONLY by `createPgAttempt` (pg/attempts.ts), which owns attempt
 * identity, limits and receiver readback. `verifyPayment` never reports a capture:
 * gateway SUCCESS is an observation (contract D2); only allocateBankCredit() captures.
 */

import type { PaymentProvider, VerifyArgs, VerifyResult, RefundResult } from './index';
import { getYoupiStatus, type YoupiConfig } from './youpi-api';
import { resolveBinding, type PgBinding } from '../pg/merchant-binding';

export const YOUPI_PROVIDER_NAME = 'youpi';

export function bindingToConfig(b: PgBinding): YoupiConfig {
  return {
    baseUrl: b.baseUrl,
    merchantId: b.merchantId,
    webhookSecret: b.webhookSecret,
    ...(b.merchantKey ? { merchantKey: b.merchantKey } : {}),
    receivingVpa: b.vpa,
    receivingAccountId: b.receivingAccountId,
    ...(process.env.NODE_ENV === 'production' ? { requireReceiverMatch: true } : {}),
    dailyLimit: b.limits.dailyLimit,
    maxAmountPaise: b.limits.maxAmountPaise,
  };
}

/**
 * Effective gateway config derived from the merchant binding. Defaults to the
 * reconciliation view (forNew=false) so a disabled merchant's in-flight payments can
 * still be read; new-session callers must pass { forNew: true }.
 */
export async function resolveYoupiConfig(
  restaurantId?: string | null,
  opts: { forNew?: boolean } = {},
): Promise<YoupiConfig | null> {
  const b = await resolveBinding(restaurantId, { forNew: opts.forNew === true });
  return b ? bindingToConfig(b) : null;
}

// Only construct via paymentProvider()/resolveYoupiConfig() (the config gate), never directly with an arbitrary cfg.
export function youpiProvider(cfg: YoupiConfig): PaymentProvider {
  return {
    name: YOUPI_PROVIDER_NAME,

    async createOrder(): Promise<never> {
      // Fail closed: a session opened here would bypass attempt identity, limits and readback.
      throw new Error('Flavrly PG sessions must be created via createPgAttempt (pg/attempts.ts)');
    },

    async verifyPayment(args: VerifyArgs): Promise<VerifyResult> {
      const id = args.providerOrderId ?? args.merchantOrderId;
      if (!id) return { ok: false, status: 'UNKNOWN', error: 'Missing Flavrly PG payment id' };
      const r = await getYoupiStatus(cfg, id);
      return {
        // Never ok: callers treat ok as "capture". A gateway SUCCESS stays indeterminate
        // ('UNKNOWN') until bank evidence is allocated by the reconciliation engine.
        ok: false,
        status: r.status === 'OBSERVED' ? 'UNKNOWN' : r.status,
        amount: typeof r.amountPaise === 'number' ? r.amountPaise / 100 : undefined,
        raw: { gatewayStatus: r.gatewayStatus ?? null, observed: r.status === 'OBSERVED', utr: r.utr ?? null },
      };
    },

    async refund(): Promise<RefundResult> {
      return { ok: false, status: 'FAILED', error: 'Flavrly PG refunds are not supported in the pilot' };
    },
  };
}
