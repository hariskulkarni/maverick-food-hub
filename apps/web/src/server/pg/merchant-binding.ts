/**
 * Merchant binding (contract D7): which gateway merchant + credentials + receiving account a
 * restaurant's Flavrly PG payments use. Fail closed: any doubt returns null.
 *
 * A binding needs
 *   - an APPROVED YoupiFeatureRequest (new sessions only, see below),
 *   - exactly one usable PgReceivingAccount for the restaurant
 *       forNew:  status VERIFIED and disabledForNewAt == null
 *       !forNew: status VERIFIED or SUSPENDED (disabling blocks new sessions only; reconciliation continues),
 *   - no OTHER restaurant holding a VERIFIED account on the same gatewayMerchantId,
 *   - credentials whose merchantId equals account.gatewayMerchantId:
 *       per-restaurant IntegrationCredential(restaurantId, YOUPI) {merchantId, merchantKey?, webhookSecret}, or
 *       the platform credential, only when account.gatewayMerchantId == platform merchantId.
 *
 * The restaurant-level `receivingVpa` config is a cross-check only; the bound account's VPA is
 * authoritative. A mismatch blocks new sessions and is logged.
 */

import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';
import { log } from '@/server/log';

/** Sentinel restaurantId for platform-level IntegrationCredential rows. */
export const PLATFORM_ID = '__platform__';

/** Conservative pilot ceilings used when nothing tighter is configured. */
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_MAX_AMOUNT_PAISE = 500000; // Rs 5,000
const DEFAULT_MAX_PENDING_PER_ACCOUNT = 5;
const DEFAULT_CUSTOMER_MAX_PENDING = 3;
const DEFAULT_CUSTOMER_WINDOW_MIN = 15;
const DEFAULT_SESSION_TTL_MIN = 15;

export type PgBinding = {
  restaurantId: string;
  receivingAccountId: string;
  gatewayMerchantId: string;
  /** Authoritative receiving VPA (normalized, lower-case). */
  vpa: string;
  baseUrl: string;
  merchantId: string;
  merchantKey?: string;
  webhookSecret: string;
  credentialSource: 'RESTAURANT' | 'PLATFORM';
  /** True when the account may not open new sessions (SUSPENDED or disabledForNewAt set). */
  disabledForNew: boolean;
  limits: {
    dailyLimit: number;
    maxAmountPaise: number;
    maxPendingPerAccount: number;
    customerMaxPending: number;
    customerWindowMinutes: number;
    sessionTtlMinutes: number;
  };
};

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Caps only tighten: the smallest configured value wins. */
function tightest(def: number, ...vals: unknown[]): number {
  return Math.min(def, ...vals.map((v) => num(v) ?? Infinity));
}

function normVpa(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export async function resolveBinding(
  restaurantId: string | null | undefined,
  opts: { forNew: boolean; receivingAccountId?: string },
): Promise<PgBinding | null> {
  if (!restaurantId) return null;
  try {
    if (opts.forNew) {
      const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId } });
      if (!fr || fr.status !== 'APPROVED') return null;
    }

    const accounts = await prisma.pgReceivingAccount.findMany({
      where: {
        restaurantId,
        ...(opts.receivingAccountId ? { id: opts.receivingAccountId } : {}),
        status: opts.forNew ? 'VERIFIED' : { in: ['VERIFIED', 'SUSPENDED'] },
        ...(opts.forNew ? { disabledForNewAt: null } : {}),
      },
    });
    // Ambiguity (two usable accounts) is never resolved by guessing.
    if (accounts.length !== 1) return null;
    const account = accounts[0];

    // A gateway merchant routes to ONE VPA, so it may back only one restaurant.
    const shared = await prisma.pgReceivingAccount.count({
      where: { gatewayMerchantId: account.gatewayMerchantId, status: 'VERIFIED', restaurantId: { not: restaurantId } },
    });
    if (shared > 0) {
      log.warn({ restaurantId, receivingAccountId: account.id }, 'pg.binding.shared_gateway_merchant');
      return null;
    }

    const platform = await getConfig(PLATFORM_ID, 'YOUPI');
    const rest = await getConfig(restaurantId, 'YOUPI');

    let creds: Record<string, string> | null = null;
    let credentialSource: PgBinding['credentialSource'] = 'RESTAURANT';
    if (rest?.merchantId) {
      creds = rest;
    } else if (platform?.merchantId && platform.merchantId === account.gatewayMerchantId) {
      creds = platform;
      credentialSource = 'PLATFORM';
    }
    // Credentials must belong to exactly the bound gateway merchant (cross-tenant guard).
    if (!creds || creds.merchantId !== account.gatewayMerchantId) {
      log.warn({ restaurantId, receivingAccountId: account.id }, 'pg.binding.credential_merchant_mismatch');
      return null;
    }
    const baseUrl = creds.baseUrl || platform?.baseUrl;
    if (!baseUrl || !creds.webhookSecret) return null;

    const accountVpa = normVpa(account.vpaNormalized || account.vpa);
    if (!accountVpa) return null;
    const configuredVpa = normVpa(rest?.receivingVpa);
    if (configuredVpa && configuredVpa !== accountVpa) {
      log.warn({ restaurantId, receivingAccountId: account.id }, 'pg.binding.configured_vpa_differs_from_bound_account');
      if (opts.forNew) return null;
    }

    return {
      restaurantId,
      receivingAccountId: account.id,
      gatewayMerchantId: account.gatewayMerchantId,
      vpa: accountVpa,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      merchantId: creds.merchantId,
      ...(creds.merchantKey ? { merchantKey: creds.merchantKey } : {}),
      webhookSecret: creds.webhookSecret,
      credentialSource,
      disabledForNew: account.status !== 'VERIFIED' || account.disabledForNewAt !== null,
      limits: {
        dailyLimit: tightest(DEFAULT_DAILY_LIMIT, platform?.dailyLimit, rest?.dailyLimit, account.dailyCountLimit),
        maxAmountPaise: tightest(DEFAULT_MAX_AMOUNT_PAISE, platform?.maxAmountPaise, rest?.maxAmountPaise, account.maxAmountPaise),
        maxPendingPerAccount: tightest(DEFAULT_MAX_PENDING_PER_ACCOUNT, platform?.maxPendingPerAccount),
        customerMaxPending: tightest(DEFAULT_CUSTOMER_MAX_PENDING, platform?.customerMaxPending),
        customerWindowMinutes: num(platform?.customerWindowMinutes) ?? DEFAULT_CUSTOMER_WINDOW_MIN,
        sessionTtlMinutes: num(platform?.sessionTtlMinutes) ?? DEFAULT_SESSION_TTL_MIN,
      },
    };
  } catch (e) {
    // Fail closed: any lookup/decrypt error means no binding.
    log.warn({ restaurantId, err: (e as Error).message }, 'pg.binding.lookup_failed');
    return null;
  }
}
