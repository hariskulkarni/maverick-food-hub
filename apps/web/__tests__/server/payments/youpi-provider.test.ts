import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findUnique, getConfig, getConfigInherited, createYoupiPayment, getYoupiStatus, assertUnderCap } = vi.hoisted(
  () => ({
    findUnique: vi.fn(),
    getConfig: vi.fn(),
    getConfigInherited: vi.fn(),
    createYoupiPayment: vi.fn(),
    getYoupiStatus: vi.fn(),
    assertUnderCap: vi.fn(),
  }),
);
vi.mock('@/server/db', () => ({ prisma: { youpiFeatureRequest: { findUnique } } }));
vi.mock('@/server/integrations', () => ({ getConfig, getConfigInherited }));
vi.mock('@/server/payments/youpi-api', () => ({ createYoupiPayment, getYoupiStatus }));
vi.mock('@/server/payments/youpi-caps', () => ({ assertUnderCap }));

import { resolveYoupiConfig, youpiProvider, YOUPI_PROVIDER_NAME } from '@/server/payments/youpi';
import { paymentProvider, youpiEnabledForRestaurant } from '@/server/payments';

const platform = { baseUrl: 'https://youpi.test', merchantId: 'm', webhookSecret: 'w', dailyLimit: '10', maxAmountPaise: '500000' };
const rest = { receivingVpa: 'shop@upi' };

function wire(opts: { approved?: boolean; platform?: any; rest?: any } = {}) {
  const { approved = true, platform: p = platform, rest: r = rest } = opts;
  findUnique.mockResolvedValue(approved ? { status: 'APPROVED' } : { status: 'REQUESTED' });
  getConfig.mockImplementation(async (id: string) => (id === '__platform__' ? p : r));
}

const cfg = { baseUrl: 'https://youpi.test', merchantId: 'm', webhookSecret: 'w', receivingVpa: 'shop@upi' };
const baseArgs = {
  orderId: 'o1',
  amount: 250.5,
  currency: 'INR',
  customer: { name: 'A', phone: '9' },
  restaurantId: 'r1',
};

beforeEach(() => {
  for (const m of [findUnique, getConfig, getConfigInherited, createYoupiPayment, getYoupiStatus, assertUnderCap]) m.mockReset();
  getConfigInherited.mockResolvedValue(null);
  assertUnderCap.mockResolvedValue(undefined);
});

describe('resolveYoupiConfig', () => {
  it('null when not APPROVED', async () => {
    wire({ approved: false });
    expect(await resolveYoupiConfig('r1')).toBeNull();
  });
  it('null when no feature request row', async () => {
    wire();
    findUnique.mockResolvedValue(null);
    expect(await resolveYoupiConfig('r1')).toBeNull();
  });
  it('null when no restaurantId', async () => {
    wire();
    expect(await resolveYoupiConfig(null)).toBeNull();
  });
  it('null without platform config', async () => {
    wire({ platform: null });
    expect(await resolveYoupiConfig('r1')).toBeNull();
  });
  it('null without restaurant VPA', async () => {
    wire({ rest: null });
    expect(await resolveYoupiConfig('r1')).toBeNull();
    wire({ rest: {} });
    expect(await resolveYoupiConfig('r1')).toBeNull();
  });
  it('merged config when all present', async () => {
    wire();
    expect(await resolveYoupiConfig('r1')).toEqual({
      baseUrl: 'https://youpi.test',
      merchantId: 'm',
      webhookSecret: 'w',
      receivingVpa: 'shop@upi',
      dailyLimit: 10,
      maxAmountPaise: 500000,
    });
  });
  it('restaurant can lower caps', async () => {
    wire({ platform: { ...platform, dailyLimit: '20' }, rest: { receivingVpa: 'shop@upi', dailyLimit: '5', maxAmountPaise: '1000' } });
    const c = await resolveYoupiConfig('r1');
    expect(c?.dailyLimit).toBe(5);
    expect(c?.maxAmountPaise).toBe(1000);
  });
  it('restaurant cannot raise caps', async () => {
    wire({ platform: { ...platform, dailyLimit: '20', maxAmountPaise: '300000' }, rest: { receivingVpa: 'shop@upi', dailyLimit: '50', maxAmountPaise: '900000' } });
    const c = await resolveYoupiConfig('r1');
    expect(c?.dailyLimit).toBe(20);
    expect(c?.maxAmountPaise).toBe(300000);
  });
  it('defaults: daily 20, max 500000 when nothing set or invalid', async () => {
    wire({ platform: { baseUrl: 'https://youpi.test', merchantId: 'm', webhookSecret: 'w', maxAmountPaise: 'abc', dailyLimit: '-1' }, rest: { receivingVpa: 'shop@upi', maxAmountPaise: '0' } });
    const c = await resolveYoupiConfig('r1');
    expect(c?.maxAmountPaise).toBe(500000);
    expect(c?.dailyLimit).toBe(20);
  });
});

describe('youpiProvider.createOrder', () => {
  it('checks caps before creating payment and returns ProviderOrder', async () => {
    const order: string[] = [];
    assertUnderCap.mockImplementation(async () => void order.push('cap'));
    createYoupiPayment.mockImplementation(async () => {
      order.push('create');
      return { paymentId: 'p1', checkoutUrl: 'https://pay/p1' };
    });
    const po = await youpiProvider(cfg).createOrder(baseArgs);
    expect(order).toEqual(['cap', 'create']);
    expect(assertUnderCap).toHaveBeenCalledWith('r1', 25050, cfg);
    expect(createYoupiPayment.mock.calls[0][1].amountPaise).toBe(25050);
    expect(po).toMatchObject({
      providerName: 'youpi',
      providerOrderId: 'p1',
      redirectUrl: 'https://pay/p1',
      amount: 250.5,
      currency: 'INR',
    });
  });
  it.each([NaN, -5, 0, Infinity])('rejects amount %s without calling YouPI', async (amount) => {
    await expect(youpiProvider(cfg).createOrder({ ...baseArgs, amount })).rejects.toThrow();
    expect(createYoupiPayment).not.toHaveBeenCalled();
    expect(assertUnderCap).not.toHaveBeenCalled();
  });
  it('does not create payment when cap throws', async () => {
    assertUnderCap.mockRejectedValue(new Error('cap'));
    await expect(youpiProvider(cfg).createOrder(baseArgs)).rejects.toThrow('cap');
    expect(createYoupiPayment).not.toHaveBeenCalled();
  });
});

describe('youpiProvider.verifyPayment', () => {
  it.each(['CAPTURED', 'PENDING', 'FAILED', 'UNKNOWN'] as const)('maps %s', async (status) => {
    getYoupiStatus.mockResolvedValue({ status, amountPaise: 25050 });
    const r = await youpiProvider(cfg).verifyPayment({ providerOrderId: 'p1' });
    expect(getYoupiStatus).toHaveBeenCalledWith(cfg, 'p1');
    expect(r.status).toBe(status);
    expect(r.ok).toBe(status === 'CAPTURED');
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

  it('prefer youpi + config -> youpi provider', async () => {
    wire();
    const p = await paymentProvider('r1', { prefer: 'youpi' });
    expect(p.name).toBe(YOUPI_PROVIDER_NAME);
  });
  it('prefer youpi + no config -> throws in prod', async () => {
    wire({ approved: false });
    (process.env as any).NODE_ENV = 'production';
    await expect(paymentProvider('r1', { prefer: 'youpi' })).rejects.toThrow(/YouPI/);
  });
  it('prefer youpi + no config -> throws outside prod too (no silent fallback)', async () => {
    wire({ approved: false });
    await expect(paymentProvider('r1', { prefer: 'youpi' })).rejects.toThrow(/YouPI/);
  });
  it('no prefer -> never youpi', async () => {
    wire();
    const p = await paymentProvider('r1');
    expect(p.name).not.toBe('youpi');
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('youpiEnabledForRestaurant reflects resolve', async () => {
    wire();
    expect(await youpiEnabledForRestaurant('r1')).toBe(true);
    wire({ approved: false });
    expect(await youpiEnabledForRestaurant('r1')).toBe(false);
  });
});
