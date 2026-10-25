/**
 * Pluggable payment / dependency health providers.
 *
 * Built-in providers read EXISTING tables only (Payment, PaymentWebhookEvent) —
 * no payment code is touched. Other modules (e.g. the Flavrly PG branch) can
 * register their own provider at import time:
 *
 *   import { registerHealthProvider } from '@/server/observability/providers';
 *   registerHealthProvider({ key: 'flavrly-pg', label: 'Flavrly PG', check: async () => ({ status: 'UP', detail: '…' }) });
 *
 * A provider's check must be fast (< 2s) and must not throw; we time-box and
 * catch anyway.
 */
import { prisma } from '../db';

export type ProviderStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface ProviderResult {
  status: ProviderStatus;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface HealthProvider {
  key: string;
  label: string;
  check: () => Promise<ProviderResult>;
}

declare global {
  // eslint-disable-next-line no-var
  var __obsProviders: Map<string, HealthProvider> | undefined;
}

function registry(): Map<string, HealthProvider> {
  if (!global.__obsProviders) global.__obsProviders = new Map();
  return global.__obsProviders;
}

export function registerHealthProvider(p: HealthProvider): void {
  registry().set(p.key, p);
}

export function unregisterHealthProvider(key: string): void {
  registry().delete(key);
}

/** Pure status rule for a payment provider over the last hour. */
export function paymentProviderStatus(success: number, failed: number): ProviderStatus {
  const decided = success + failed;
  if (decided === 0) return 'UNKNOWN';
  if (decided < 5) return failed > success ? 'DEGRADED' : 'UP'; // too few samples for a hard verdict
  const rate = success / decided;
  if (rate < 0.5) return 'DOWN';
  if (rate < 0.85) return 'DEGRADED';
  return 'UP';
}

function paymentProvider(key: string, label: string): HealthProvider {
  return {
    key: `payments:${key}`,
    label,
    check: async () => {
      const hourAgo = new Date(Date.now() - 3_600_000);
      const dayAgo = new Date(Date.now() - 86_400_000);
      const [rows, lastOk, lastFail, webhooks, webhookErrors] = await Promise.all([
        prisma.payment.groupBy({ by: ['status'], where: { providerName: key, createdAt: { gte: hourAgo } }, _count: { _all: true } }),
        prisma.payment.findFirst({ where: { providerName: key, status: { in: ['CAPTURED', 'AUTHORIZED'] } }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
        prisma.payment.findFirst({ where: { providerName: key, status: 'FAILED' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, errorMessage: true } }),
        prisma.paymentWebhookEvent.findFirst({ where: { provider: key }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
        prisma.paymentWebhookEvent.count({ where: { provider: key, createdAt: { gte: dayAgo }, error: { not: null } } }),
      ]);
      const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
      const success = n('CAPTURED') + n('AUTHORIZED');
      const failed = n('FAILED');
      const pending = n('PENDING');
      const status = paymentProviderStatus(success, failed);
      return {
        status,
        detail:
          success + failed + pending === 0
            ? 'No payments in the last hour'
            : `1h: ${success} ok · ${failed} failed · ${pending} pending`,
        meta: {
          success1h: success,
          failed1h: failed,
          pending1h: pending,
          lastSuccessAt: lastOk?.updatedAt?.toISOString() ?? null,
          lastFailureAt: lastFail?.updatedAt?.toISOString() ?? null,
          lastWebhookAt: webhooks?.createdAt?.toISOString() ?? null,
          webhookErrors24h: webhookErrors,
        },
      };
    },
  };
}

const BUILT_INS: HealthProvider[] = [
  paymentProvider('phonepe', 'PhonePe'),
  paymentProvider('razorpay', 'Razorpay'),
  paymentProvider('youpi', 'YouPI'),
];

async function timeBox<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error('timeout')), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function runHealthProviders(): Promise<Array<{ key: string; label: string } & ProviderResult>> {
  const all = [...BUILT_INS, ...registry().values()];
  return Promise.all(
    all.map(async (p) => {
      try {
        const r = await timeBox(p.check(), 3000);
        return { key: p.key, label: p.label, ...r };
      } catch (e) {
        return { key: p.key, label: p.label, status: 'UNKNOWN' as const, detail: `check failed: ${(e as Error).message?.slice(0, 80)}` };
      }
    }),
  );
}
