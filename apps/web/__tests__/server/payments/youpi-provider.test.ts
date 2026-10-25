import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getConfig, getConfigInherited, getYoupiStatus, resolveBinding } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getConfigInherited: vi.fn(),
  getYoupiStatus: vi.fn(),
  resolveBinding: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/integrations', () => ({ getConfig, getConfigInherited }));
vi.mock('@/server/payments/youpi-api', () => ({ getYoupiStatus }));
vi.mock('@/server/pg/merchant-binding', () => ({ resolveBinding }));

import { resolveYoupiConfig, youpiProvider, YOUPI_PROVIDER_NAME } from '@/server/payments/youpi';
import { paymentProvider, youpiEnabledForRestaurant } from '@/server/payments';

const binding = {
  restaurantId: 'r1',
  receivingAccountId: 'acc1',
  gatewayMerchantId: 'm1',
  vpa: 'shop@upi',
  baseUrl: 'https://youpi.test',
  merchantId: 'm1',
  webhookSecret: 'w-fake',
  credentialSource: 'RESTAURANT',
  disabledForNew: false,
  limits: { dailyLimit: 10, maxAmountPaise: 500000, maxPendingPerAccount: 5, customerMaxPending: 3, customerWindowMinutes: 15, sessionTtlMinutes: 15 },
};
const cfg = { baseUrl: 'https://youpi.test', merchantId: 'm1', webhookSecret: 'w-fake', receivingVpa: 'shop@upi' };

beforeEach(() => {
  for (const m of [getConfig, getConfigInherited, getYoupiStatus, resolveBinding]) m.mockReset();
  getConfigInherited.mockResolvedValue(null);
});

describe('resolveYoupiConfig (derived from the merchant binding)', () => {
  it('null when there is no binding', async () => {
    resolveBinding.mockResolvedValue(null);
    expect(await resolveYoupiConfig('r1')).toBeNull();
  });
  it('defaults to the reconciliation view (forNew=false) so disabled merchants still reconcile', async () => {
    resolveBinding.mockResolvedValue(binding);
    await resolveYoupiConfig('r1');
    expect(resolveBinding).toHaveBeenCalledWith('r1', { forNew: false });
    await resolveYoupiConfig('r1', { forNew: true });
    expect(resolveBinding).toHaveBeenLastCalledWith('r1', { forNew: true });
  });
  it('maps binding -> config; the bound account VPA is authoritative', async () => {
    resolveBinding.mockResolvedValue({ ...binding, merchantKey: 'mk-fake' });
    expect(await resolveYoupiConfig('r1')).toEqual({
      baseUrl: 'https://youpi.test',
      merchantId: 'm1',
      webhookSecret: 'w-fake',
      merchantKey: 'mk-fake',
      receivingVpa: 'shop@upi',
      receivingAccountId: 'acc1',
      dailyLimit: 10,
      maxAmountPaise: 500000,
    });
  });
});

describe('youpiProvider.createOrder', () => {
  it('refuses: sessions are only opened via createPgAttempt', async () => {
    await expect(
      youpiProvider(cfg).createOrder({ orderId: 'o1', amount: 10, currency: 'INR', customer: {}, restaurantId: 'r1' }),
    ).rejects.toThrow(/createPgAttempt/);
  });
});

describe('youpiProvider.verifyPayment never reports a capture (D2)', () => {
  it.each([
    ['OBSERVED', 'UNKNOWN'],
    ['PENDING', 'PENDING'],
    ['FAILED', 'FAILED'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)('maps %s -> %s with ok=false', async (status, expected) => {
    getYoupiStatus.mockResolvedValue({ status, gatewayStatus: 'X', amountPaise: 25050 });
    const r = await youpiProvider(cfg).verifyPayment({ providerOrderId: 'p1' });
    expect(getYoupiStatus).toHaveBeenCalledWith(cfg, 'p1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(expected);
    expect(r.raw).toMatchObject({ observed: status === 'OBSERVED' });
  });
  it('UNKNOWN without an id', async () => {
    const r = await youpiProvider(cfg).verifyPayment({});
    expect(r.status).toBe('UNKNOWN');
    expect(getYoupiStatus).not.toHaveBeenCalled();
  });
});

describe('paymentProvider selection', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as any).NODE_ENV = env;
  });

  it('defaults to disabled for NEW production checkouts without changing reconciliation config', async () => {
    const prior = process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED;
    try {
      resolveBinding.mockResolvedValue(binding);
      (process.env as any).NODE_ENV = 'production';
      delete process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED;
      expect(await youpiEnabledForRestaurant('r1')).toBe(false);
      await expect(paymentProvider('r1', { prefer: 'youpi' })).rejects.toThrow(/disabled/);
      // Existing in-flight reconciliation may still fetch the current credentials.
      expect(await resolveYoupiConfig('r1')).not.toBeNull();
    } finally {
      if (prior === undefined) delete process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED;
      else process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED = prior;
    }
  });

  it('prefer youpi + binding -> youpi provider, resolved for NEW sessions', async () => {
    resolveBinding.mockResolvedValue(binding);
    const p = await paymentProvider('r1', { prefer: 'youpi' });
    expect(p.name).toBe(YOUPI_PROVIDER_NAME);
    expect(resolveBinding).toHaveBeenCalledWith('r1', { forNew: true });
  });
  it('prefer youpi + no binding -> throws (no silent fallback)', async () => {
    resolveBinding.mockResolvedValue(null);
    await expect(paymentProvider('r1', { prefer: 'youpi' })).rejects.toThrow(/Flavrly PG/);
    (process.env as any).NODE_ENV = 'production';
    process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED = 'true';
    try {
      await expect(paymentProvider('r1', { prefer: 'youpi' })).rejects.toThrow(/Flavrly PG/);
    } finally {
      delete process.env.FLAVRLY_PG_NEW_PAYMENTS_ENABLED;
    }
  });
  it('no prefer -> never youpi', async () => {
    resolveBinding.mockResolvedValue(binding);
    const p = await paymentProvider('r1');
    expect(p.name).not.toBe('youpi');
    expect(resolveBinding).not.toHaveBeenCalled();
  });
  it('youpiEnabledForRestaurant reflects the NEW-session binding', async () => {
    resolveBinding.mockResolvedValue(binding);
    expect(await youpiEnabledForRestaurant('r1')).toBe(true);
    expect(resolveBinding).toHaveBeenCalledWith('r1', { forNew: true });
    resolveBinding.mockResolvedValue(null);
    expect(await youpiEnabledForRestaurant('r1')).toBe(false);
  });
});
