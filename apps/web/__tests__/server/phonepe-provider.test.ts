/**
 * PhonePe adapter — the PaymentProvider seam, plus credential resolution and
 * the gateway-selection precedence in `paymentProvider()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createPayment: vi.fn(),
  createRefund: vi.fn(),
  getOrderStatus: vi.fn(),
  getRefundStatus: vi.fn(),
}));
const integrations = vi.hoisted(() => {
  const getConfig = vi.fn();
  // getConfigInherited is the real entry point for the payment paths now. In
  // these tests there is no restaurant hierarchy, so it degrades to "whatever
  // getConfig returns for this id", wrapped in the InheritedConfig envelope.
  const getConfigInherited = vi.fn(async (restaurantId: string, provider: string) => {
    const config = await getConfig(restaurantId, provider);
    return config ? { config, ownerRestaurantId: restaurantId, inherited: false } : null;
  });
  return { getConfig, getConfigInherited };
});

vi.mock('@/server/payments/phonepe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/payments/phonepe-api')>();
  return { ...actual, ...api };
});
vi.mock('@/server/integrations', () => integrations);
vi.mock('@/lib/brand', () => ({ brand: { name: 'Flavrly', url: 'https://flavrly.test' } }));

import {
  phonepeProvider,
  phonePeConfigFromStored,
  phonePeRedirectUrl,
  resolvePhonePeConfig,
} from '@/server/payments/phonepe';
import { paymentProvider, resolveGatewayKey } from '@/server/payments';
import type { PhonePeConfig } from '@/server/payments/phonepe-api';

const CFG: PhonePeConfig = { clientId: 'CID', clientSecret: 'CSEC', clientVersion: '1', env: 'SANDBOX' };

const ENV_KEYS = [
  'PHONEPE_CLIENT_ID',
  'PHONEPE_CLIENT_SECRET',
  'PHONEPE_CLIENT_VERSION',
  'PHONEPE_ENV',
  'PHONEPE_WEBHOOK_USERNAME',
  'PHONEPE_WEBHOOK_PASSWORD',
  'PAYMENT_PROVIDER',
  'RAZORPAY_KEY_ID',
];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
  integrations.getConfig.mockReset();
  integrations.getConfig.mockResolvedValue(null);
  // Re-install the pass-through each time: individual tests replace it (e.g.
  // to simulate the store throwing) and mockClear alone would leave that behind.
  integrations.getConfigInherited.mockReset();
  integrations.getConfigInherited.mockImplementation(async (restaurantId: string, provider: string) => {
    const config = await integrations.getConfig(restaurantId, provider);
    return config ? { config, ownerRestaurantId: restaurantId, inherited: false } : null;
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('phonePeConfigFromStored', () => {
  it('builds a config from a stored credential blob', () => {
    expect(
      phonePeConfigFromStored({
        clientId: 'A',
        clientSecret: 'B',
        clientVersion: '2',
        env: 'production',
        webhookUsername: 'u',
        webhookPassword: 'p',
      }),
    ).toEqual({
      clientId: 'A',
      clientSecret: 'B',
      clientVersion: '2',
      env: 'PRODUCTION',
      webhookUsername: 'u',
      webhookPassword: 'p',
    });
  });

  it('defaults clientVersion to 1 and env to SANDBOX — never silently production', () => {
    const cfg = phonePeConfigFromStored({ clientId: 'A', clientSecret: 'B' })!;
    expect(cfg.clientVersion).toBe('1');
    expect(cfg.env).toBe('SANDBOX');
  });

  it('returns null when either half of the credential is missing', () => {
    expect(phonePeConfigFromStored(null)).toBeNull();
    expect(phonePeConfigFromStored({})).toBeNull();
    expect(phonePeConfigFromStored({ clientId: 'A' })).toBeNull();
    expect(phonePeConfigFromStored({ clientSecret: 'B' })).toBeNull();
  });

  it('treats any env value other than PRODUCTION as SANDBOX', () => {
    expect(phonePeConfigFromStored({ clientId: 'A', clientSecret: 'B', env: 'staging' })!.env).toBe('SANDBOX');
    expect(phonePeConfigFromStored({ clientId: 'A', clientSecret: 'B', env: 'PRODUCTION' })!.env).toBe('PRODUCTION');
  });
});

describe('resolvePhonePeConfig', () => {
  it('prefers the tenant credential over the platform env', async () => {
    process.env.PHONEPE_CLIENT_ID = 'ENV_ID';
    process.env.PHONEPE_CLIENT_SECRET = 'ENV_SECRET';
    integrations.getConfig.mockResolvedValue({ clientId: 'TENANT_ID', clientSecret: 'TENANT_SECRET' });
    expect((await resolvePhonePeConfig('rest_1'))!.clientId).toBe('TENANT_ID');
  });

  it('falls back to env when the tenant has none', async () => {
    process.env.PHONEPE_CLIENT_ID = 'ENV_ID';
    process.env.PHONEPE_CLIENT_SECRET = 'ENV_SECRET';
    expect((await resolvePhonePeConfig('rest_1'))!.clientId).toBe('ENV_ID');
  });

  it('falls back to env when the credential store throws — checkout must not die on a DB blip', async () => {
    process.env.PHONEPE_CLIENT_ID = 'ENV_ID';
    process.env.PHONEPE_CLIENT_SECRET = 'ENV_SECRET';
    integrations.getConfig.mockRejectedValue(new Error('redis down'));
    integrations.getConfigInherited.mockRejectedValue(new Error('redis down'));
    expect((await resolvePhonePeConfig('rest_1'))!.clientId).toBe('ENV_ID');
  });

  it('returns null when nothing is configured anywhere', async () => {
    expect(await resolvePhonePeConfig('rest_1')).toBeNull();
    expect(await resolvePhonePeConfig()).toBeNull();
  });
});

describe('phonePeRedirectUrl', () => {
  it('points at our return handler and carries the merchant order id', () => {
    expect(phonePeRedirectUrl('ord-1')).toBe('https://flavrly.test/api/payments/phonepe/return?ref=ord-1');
  });
  it('tolerates a trailing slash on the brand URL', () => {
    expect(phonePeRedirectUrl('ord-1', 'https://x.test/')).toBe('https://x.test/api/payments/phonepe/return?ref=ord-1');
  });
  it('url-encodes the reference', () => {
    expect(phonePeRedirectUrl('a b')).toContain('ref=a%20b');
  });
});

describe('adapter — createOrder', () => {
  it('converts rupees to paisa, sets metaInfo, and returns the PayPage URL', async () => {
    api.createPayment.mockResolvedValue({
      orderId: 'OMO1',
      state: 'PENDING',
      expireAt: 1700000000000,
      redirectUrl: 'https://mercury-stg.phonepe.com/transact?token=abc',
      raw: { orderId: 'OMO1' },
    });

    const res = await phonepeProvider(CFG).createOrder({
      orderId: 'cmorder1',
      orderCode: 'ORD-AB12CD',
      amount: 499.5,
      currency: 'INR',
      customer: { name: 'Asha', phone: '+919876543210', email: null },
      restaurantId: 'rest_1',
      branchId: 'branch_1',
      merchantOrderId: 'cmorder1-1',
    });

    const input = api.createPayment.mock.calls[0][1];
    expect(input.amountPaisa).toBe(49950);
    expect(input.merchantOrderId).toBe('cmorder1-1');
    expect(input.redirectUrl).toContain('/api/payments/phonepe/return?ref=cmorder1-1');
    expect(input.metaInfo).toEqual({
      udf1: 'cmorder1',
      udf2: 'ORD-AB12CD',
      udf3: 'rest_1',
      udf4: 'branch_1',
      udf5: '+919876543210',
    });

    // providerOrderId is our merchantOrderId, NOT PhonePe's OMO id — refunds
    // and webhooks are both addressed by ours.
    expect(res.providerOrderId).toBe('cmorder1-1');
    expect(res.gatewayOrderId).toBe('OMO1');
    expect(res.redirectUrl).toBe('https://mercury-stg.phonepe.com/transact?token=abc');
    expect(res.checkoutScriptUrl).toBe('https://mercury-stg.phonepe.com/web/bundle/checkout.js');
    expect(res.env).toBe('SANDBOX');
    expect(res.providerName).toBe('phonepe');
  });

  it('sanitises an unsafe order id into something PhonePe accepts', async () => {
    api.createPayment.mockResolvedValue({ orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y', raw: {} });
    await phonepeProvider(CFG).createOrder({
      orderId: 'order/with spaces',
      amount: 10,
      currency: 'INR',
      customer: {},
    });
    expect(api.createPayment.mock.calls[0][1].merchantOrderId).toBe('order-with-spaces');
  });

  it('loads the production bundle for production credentials', async () => {
    api.createPayment.mockResolvedValue({ orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y', raw: {} });
    const res = await phonepeProvider({ ...CFG, env: 'PRODUCTION' }).createOrder({
      orderId: 'o1',
      amount: 10,
      currency: 'INR',
      customer: {},
    });
    expect(res.checkoutScriptUrl).toBe('https://mercury.phonepe.com/web/bundle/checkout.js');
  });
});

describe('adapter — verifyPayment', () => {
  it('ignores the client entirely and asks the Order Status API', async () => {
    api.getOrderStatus.mockResolvedValue({
      orderId: 'OMO1',
      state: 'COMPLETED',
      amount: 49950,
      paymentDetails: [{ transactionId: 'OM99', paymentMode: 'UPI_INTENT', state: 'COMPLETED' }],
      raw: {},
    });

    const res = await phonepeProvider(CFG).verifyPayment({
      merchantOrderId: 'ord-1',
      // A forged client-side "signature" must have no effect whatsoever.
      signature: 'totally-made-up',
      providerPaymentId: 'attacker-supplied',
    });

    expect(api.getOrderStatus).toHaveBeenCalledWith(CFG, 'ord-1');
    expect(res).toMatchObject({ ok: true, status: 'CAPTURED', providerPaymentId: 'OM99', amount: 499.5, paymentMode: 'UPI_INTENT' });
  });

  it('reports PENDING as not-ok but not failed', async () => {
    api.getOrderStatus.mockResolvedValue({ orderId: 'O', state: 'PENDING', paymentDetails: [], raw: {} });
    expect(await phonepeProvider(CFG).verifyPayment({ merchantOrderId: 'o' })).toMatchObject({ ok: false, status: 'PENDING' });
  });

  it('maps a failure to customer-safe copy', async () => {
    api.getOrderStatus.mockResolvedValue({
      orderId: 'O',
      state: 'FAILED',
      errorCode: 'AUTHORIZATION_ERROR',
      detailedErrorCode: 'ZM',
      paymentDetails: [],
      raw: {},
    });
    const res = await phonepeProvider(CFG).verifyPayment({ merchantOrderId: 'o' });
    expect(res).toMatchObject({ ok: false, status: 'FAILED', errorCode: 'ZM' });
    expect(res.error).toBe('Incorrect UPI PIN. Please try again.');
  });

  it('returns UNKNOWN — not FAILED — when the gateway is unreachable', async () => {
    // This distinction is what stops a network blip from marking a paid order
    // as failed.
    api.getOrderStatus.mockRejectedValue(Object.assign(new Error('ECONNRESET'), { code: 'NETWORK_ERROR' }));
    const res = await phonepeProvider(CFG).verifyPayment({ merchantOrderId: 'o' });
    expect(res.status).toBe('UNKNOWN');
    expect(res.ok).toBe(false);
  });

  it('accepts providerOrderId as an alias for merchantOrderId', async () => {
    api.getOrderStatus.mockResolvedValue({ orderId: 'O', state: 'PENDING', paymentDetails: [], raw: {} });
    await phonepeProvider(CFG).verifyPayment({ providerOrderId: 'alias-1' });
    expect(api.getOrderStatus).toHaveBeenCalledWith(CFG, 'alias-1');
  });

  it('fails cleanly when no order reference is supplied', async () => {
    expect(await phonepeProvider(CFG).verifyPayment({})).toMatchObject({ ok: false });
    expect(api.getOrderStatus).not.toHaveBeenCalled();
  });
});

describe('adapter — refund', () => {
  it('refunds against the original merchant order id in paisa', async () => {
    api.createRefund.mockResolvedValue({ refundId: 'OMR7', amount: 10000, state: 'PENDING', raw: {} });
    const res = await phonepeProvider(CFG).refund({
      originalMerchantOrderId: 'ord-1',
      merchantRefundId: 'rfnd-xyz',
      amount: 100,
    });
    expect(api.createRefund).toHaveBeenCalledWith(CFG, {
      merchantRefundId: 'rfnd-xyz',
      originalMerchantOrderId: 'ord-1',
      amountPaisa: 10000,
    });
    // providerRefundId is OUR key (what refund status is queried by), the
    // gateway's OMR id is kept separately.
    expect(res).toMatchObject({ ok: true, providerRefundId: 'rfnd-xyz', gatewayRefundId: 'OMR7', status: 'PENDING' });
  });

  it('reports failure without throwing', async () => {
    api.createRefund.mockRejectedValue(Object.assign(new Error('Refund window closed'), { code: 'REFUND_FOR_TXN_OLDER_THAN_LIMIT' }));
    const res = await phonepeProvider(CFG).refund({ originalMerchantOrderId: 'ord-1', merchantRefundId: 'r', amount: 10 });
    expect(res).toMatchObject({ ok: false, errorCode: 'REFUND_FOR_TXN_OLDER_THAN_LIMIT' });
  });

  it('refuses without an original order reference', async () => {
    expect(await phonepeProvider(CFG).refund({ amount: 10 })).toMatchObject({ ok: false });
    expect(api.createRefund).not.toHaveBeenCalled();
  });
});

describe('gateway selection', () => {
  it('prefers a tenant PhonePe credential over a tenant Razorpay credential', async () => {
    integrations.getConfig.mockImplementation(async (_r: string, provider: string) =>
      provider === 'PHONEPE'
        ? { clientId: 'A', clientSecret: 'B' }
        : { keyId: 'rzp_x', keySecret: 'y' },
    );
    expect(await resolveGatewayKey('rest_1')).toBe('PHONEPE');
  });

  it('uses Razorpay when that is the only tenant credential', async () => {
    integrations.getConfig.mockImplementation(async (_r: string, provider: string) =>
      provider === 'RAZORPAY' ? { keyId: 'rzp_x', keySecret: 'y' } : null,
    );
    expect(await resolveGatewayKey('rest_1')).toBe('RAZORPAY');
  });

  it('ignores a half-configured tenant credential', async () => {
    integrations.getConfig.mockImplementation(async (_r: string, provider: string) =>
      provider === 'PHONEPE' ? { clientId: 'A' } : null,
    );
    expect(await resolveGatewayKey('rest_1')).toBeNull();
  });

  it('falls back to PAYMENT_PROVIDER only when the matching env credential exists', async () => {
    process.env.PAYMENT_PROVIDER = 'phonepe';
    expect(await resolveGatewayKey()).toBeNull();
    process.env.PHONEPE_CLIENT_ID = 'X';
    expect(await resolveGatewayKey()).toBe('PHONEPE');
  });

  it('returns the mock provider when nothing is configured', async () => {
    const p = await paymentProvider('rest_1');
    expect(p.name).toBe('mock');
  });

  it('builds a real PhonePe provider for a configured tenant', async () => {
    integrations.getConfig.mockImplementation(async (_r: string, provider: string) =>
      provider === 'PHONEPE' ? { clientId: 'A', clientSecret: 'B', clientVersion: '1' } : null,
    );
    const p = await paymentProvider('rest_1');
    expect(p.name).toBe('phonepe');
  });
});
