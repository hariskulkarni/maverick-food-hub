/**
 * C1 — paymentProvider() must never silently fall back to the auto-approving
 * mock in production.
 *
 * The resolver lands on mockProvider() for every path that fails to resolve a
 * real gateway (unconfigured tenant, rotated/undecryptable credential, typo'd
 * env key). mockProvider.verifyPayment() returns { ok: true } for any input, so
 * a single missing env var would turn every production checkout into a free
 * order. In production (without an explicit DEMO_MODE opt-in) the resolver must
 * throw instead of returning the mock.
 *
 * With restaurantId undefined, resolveGatewayKey() returns null without touching
 * the DB or crypto, so these tests stay pure; the module mocks below only keep
 * the import chain from requiring a real DB/encryption key on the runner.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} as any }));
vi.mock('@/server/crypto', () => ({
  encryptJSON: (s: unknown) => `enc(${JSON.stringify(s)})`,
  decryptJSON: <T,>(s: string) => JSON.parse(s.replace(/^enc\((.*)\)$/, '$1')) as T,
  maskSecret: (s: string | null | undefined) => (s ? '****' : '')
}));

import { paymentProvider } from '@/server/payments';

describe('C1: mock payment provider refused in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when no gateway resolves and NODE_ENV=production without DEMO_MODE', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '');
    vi.stubEnv('PAYMENT_PROVIDER', '');
    await expect(paymentProvider(undefined)).rejects.toThrow(/gateway/i);
  });

  it('returns the mock in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PAYMENT_PROVIDER', '');
    const provider = await paymentProvider(undefined);
    expect(provider.name).toBe('mock');
  });

  it('returns the mock in production only with an explicit DEMO_MODE=true opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('PAYMENT_PROVIDER', '');
    const provider = await paymentProvider(undefined);
    expect(provider.name).toBe('mock');
  });
});
