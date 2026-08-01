/**
 * PhonePe HTTP client — token lifecycle, endpoint routing, request shape,
 * retry/401 behaviour and error mapping.
 *
 * `fetch` is stubbed with responses copied from PhonePe's API reference, so
 * these assert against the documented contract rather than our own assumptions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPhonePeTokenCache,
  assertMerchantId,
  createPayment,
  createRefund,
  getAccessToken,
  getOrderStatus,
  getRefundStatus,
  MIN_AMOUNT_PAISA,
  phonePeStatusPollDelays,
  sanitizeMetaInfo,
  toPhonePePhone,
  phonePeBaseUrls,
  phonePeCheckoutScriptUrl,
  PhonePeError,
  toMerchantId,
  toPaisa,
  type PhonePeConfig,
} from '@/server/payments/phonepe-api';

const SANDBOX: PhonePeConfig = {
  clientId: 'TEST_CLIENT',
  clientSecret: 'TEST_SECRET',
  clientVersion: '1',
  env: 'SANDBOX',
};
const PROD: PhonePeConfig = { ...SANDBOX, clientId: 'PROD_CLIENT', env: 'PRODUCTION' };

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A token that expires an hour out, in epoch *seconds* as PhonePe returns it. */
function tokenBody(ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: `tok_${now}_${Math.random().toString(36).slice(2, 8)}`, issued_at: now, expires_at: now + ttlSec, token_type: 'O-Bearer' };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetPhonePeTokenCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Convenience: first call answers the token, the rest answer in order. */
function withToken(...responses: Response[]) {
  fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
}

describe('environment routing', () => {
  it('routes sandbox everything through pg-sandbox', () => {
    expect(phonePeBaseUrls('SANDBOX')).toEqual({
      auth: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
      api: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    });
  });

  it('routes production auth to identity-manager and everything else to /pg', () => {
    // This asymmetry is real and easy to get wrong — auth is NOT under /pg.
    expect(phonePeBaseUrls('PRODUCTION')).toEqual({
      auth: 'https://api.phonepe.com/apis/identity-manager',
      api: 'https://api.phonepe.com/apis/pg',
    });
  });

  it('picks the checkout bundle matching the environment', () => {
    expect(phonePeCheckoutScriptUrl('SANDBOX')).toBe('https://mercury-stg.phonepe.com/web/bundle/checkout.js');
    expect(phonePeCheckoutScriptUrl('PRODUCTION')).toBe('https://mercury.phonepe.com/web/bundle/checkout.js');
  });
});

describe('authorization', () => {
  it('posts form-urlencoded client_credentials to the right host', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
    await getAccessToken(SANDBOX);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body);
    expect(params.get('client_id')).toBe('TEST_CLIENT');
    expect(params.get('client_secret')).toBe('TEST_SECRET');
    expect(params.get('client_version')).toBe('1');
    expect(params.get('grant_type')).toBe('client_credentials');
  });

  it('uses identity-manager in production', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
    await getAccessToken(PROD);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.phonepe.com/apis/identity-manager/v1/oauth/token');
  });

  it('caches the token across calls', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
    const a = await getAccessToken(SANDBOX);
    const b = await getAccessToken(SANDBOX);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent token requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
    const [a, b, c] = await Promise.all([getAccessToken(SANDBOX), getAccessToken(SANDBOX), getAccessToken(SANDBOX)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('refreshes early — a token expiring inside the 5-minute margin is not reused', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody(120))); // expires in 2 min
    const first = await getAccessToken(SANDBOX);
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody(3600)));
    const second = await getAccessToken(SANDBOX);
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps separate cache entries per environment and per credential', async () => {
    fetchMock.mockImplementation(async () => jsonRes(tokenBody()));
    await getAccessToken(SANDBOX);
    await getAccessToken(PROD);
    await getAccessToken({ ...SANDBOX, clientSecret: 'DIFFERENT' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('raises a typed error when credentials are rejected', async () => {
    fetchMock.mockImplementation(async () => jsonRes({ code: 'UNAUTHORIZED', message: 'Invalid client' }, 401));
    await expect(getAccessToken(SANDBOX)).rejects.toBeInstanceOf(PhonePeError);
    await expect(getAccessToken(SANDBOX)).rejects.toMatchObject({ httpStatus: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a 200 with no access_token rather than caching an empty one', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ token_type: 'O-Bearer' }));
    await expect(getAccessToken(SANDBOX)).rejects.toMatchObject({ code: 'AUTH_MALFORMED' });
  });

  it('falls back to a bounded TTL when expires_at is missing or in the past', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ access_token: 'tok_no_exp' }));
    expect(await getAccessToken(SANDBOX)).toBe('tok_no_exp');
    // Cached, not re-fetched forever-expired.
    expect(await getAccessToken(SANDBOX)).toBe('tok_no_exp');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createPayment', () => {
  const PAY_OK = {
    orderId: 'OMO123456789',
    state: 'PENDING',
    expireAt: 1703756259307,
    redirectUrl: 'https://mercury-uat.phonepe.com/transact/uat_v2?token=eyJ',
  };

  it('sends the documented PG_CHECKOUT body with O-Bearer auth', async () => {
    withToken(jsonRes(PAY_OK));
    const res = await createPayment(SANDBOX, {
      merchantOrderId: 'ord-1',
      amountPaisa: 1000,
      redirectUrl: 'https://flavrly.test/api/payments/phonepe/return?ref=ord-1',
      expireAfter: 900,
      message: 'Order ORD-AB12CD',
      metaInfo: { udf1: 'internal-order-id' },
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toMatch(/^O-Bearer tok_/);
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      merchantOrderId: 'ord-1',
      amount: 1000,
      expireAfter: 900,
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: 'Order ORD-AB12CD',
        merchantUrls: { redirectUrl: 'https://flavrly.test/api/payments/phonepe/return?ref=ord-1' },
      },
      metaInfo: { udf1: 'internal-order-id' },
    });

    expect(res.redirectUrl).toBe(PAY_OK.redirectUrl);
    expect(res.orderId).toBe('OMO123456789');
    expect(res.expireAt).toBe(1703756259307);
  });

  it('hits the production /pg path when configured for production', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(PROD, { merchantOrderId: 'ord-2', amountPaisa: 100, redirectUrl: 'https://x.test/r' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.phonepe.com/apis/pg/checkout/v2/pay');
  });

  it('clamps expireAfter into PhonePe’s 300–3600s band instead of letting it 400', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, { merchantOrderId: 'o-a', amountPaisa: 100, redirectUrl: 'https://x.test/r', expireAfter: 30 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expireAfter).toBe(300);

    __resetPhonePeTokenCache();
    fetchMock.mockClear();
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, { merchantOrderId: 'o-b', amountPaisa: 100, redirectUrl: 'https://x.test/r', expireAfter: 99999 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expireAfter).toBe(3600);
  });

  it('omits expireAfter, metaInfo and paymentModeConfig when not supplied', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, { merchantOrderId: 'o-c', amountPaisa: 100, redirectUrl: 'https://x.test/r' });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).not.toHaveProperty('expireAfter');
    expect(body).not.toHaveProperty('metaInfo');
    expect(body.paymentFlow).not.toHaveProperty('paymentModeConfig');
  });

  it('rejects amounts below PhonePe’s ₹1 floor before spending a request', async () => {
    await expect(
      createPayment(SANDBOX, { merchantOrderId: 'o-d', amountPaisa: MIN_AMOUNT_PAISA - 1, redirectUrl: 'https://x.test/r' }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-integer paisa amount', async () => {
    await expect(
      createPayment(SANDBOX, { merchantOrderId: 'o-e', amountPaisa: 100.5, redirectUrl: 'https://x.test/r' }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('refuses both enabled and disabled payment modes — PhonePe forbids it', async () => {
    await expect(
      createPayment(SANDBOX, {
        merchantOrderId: 'o-f',
        amountPaisa: 100,
        redirectUrl: 'https://x.test/r',
        paymentModeConfig: { enabledPaymentModes: [{ type: 'UPI' }], disabledPaymentModes: [{ type: 'CARD' }] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_MODE_CONFIG' });
  });

  it('surfaces the duplicate-order 400 verbatim', async () => {
    withToken(jsonRes({ code: 'BAD_REQUEST', message: 'Please check the inputs you have provided.' }, 400));
    await expect(
      createPayment(SANDBOX, { merchantOrderId: 'dup-1', amountPaisa: 100, redirectUrl: 'https://x.test/r' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', httpStatus: 400 });
  });

  it('does NOT retry on 5xx — a replayed pay would risk a duplicate order', async () => {
    withToken(jsonRes({ code: 'INTERNAL_SERVER_ERROR', message: 'try again' }, 500));
    await expect(
      createPayment(SANDBOX, { merchantOrderId: 'o-g', amountPaisa: 100, redirectUrl: 'https://x.test/r' }),
    ).rejects.toMatchObject({ httpStatus: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + one pay attempt
  });

  it('errors when PhonePe accepts the order but returns no redirectUrl', async () => {
    withToken(jsonRes({ orderId: 'OMO1', state: 'PENDING' }));
    await expect(
      createPayment(SANDBOX, { merchantOrderId: 'o-h', amountPaisa: 100, redirectUrl: 'https://x.test/r' }),
    ).rejects.toMatchObject({ code: 'NO_REDIRECT_URL' });
  });
});

describe('getOrderStatus', () => {
  const STATUS_OK = {
    orderId: 'OMO2407021515185686967711',
    state: 'COMPLETED',
    amount: 1000,
    payableAmount: 1000,
    feeAmount: 0,
    expireAt: 1719913878566,
    paymentDetails: [
      {
        transactionId: 'OM2407021515097451914211',
        paymentMode: 'UPI_INTENT',
        state: 'COMPLETED',
        amount: 1000,
        rail: { type: 'UPI', upiTransactionId: 'upi12313', vpa: '12****78@ybl' },
        instrument: { type: 'ACCOUNT', maskedAccountNumber: '******1234', accountType: 'SAVINGS' },
      },
    ],
  };

  it('GETs the documented path with details and errorContext on', async () => {
    withToken(jsonRes(STATUS_OK));
    const res = await getOrderStatus(SANDBOX, 'ord-1');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order/ord-1/status?details=true&errorContext=true');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toMatch(/^O-Bearer /);
    expect(res.state).toBe('COMPLETED');
    expect(res.paymentDetails?.[0].paymentMode).toBe('UPI_INTENT');
    expect(res.raw).toMatchObject({ orderId: STATUS_OK.orderId });
  });

  it('retries transient 5xx and succeeds', async () => {
    withToken(jsonRes({ code: 'INTERNAL_SERVER_ERROR' }, 500), jsonRes(STATUS_OK));
    const res = await getOrderStatus(SANDBOX, 'ord-1');
    expect(res.state).toBe('COMPLETED');
  });

  it('force-refreshes the token and replays once on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody())); // initial token
    fetchMock.mockResolvedValueOnce(jsonRes({ code: 'UNAUTHORIZED' }, 401)); // stale
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody())); // forced refresh
    fetchMock.mockResolvedValueOnce(jsonRes(STATUS_OK)); // replay
    const res = await getOrderStatus(SANDBOX, 'ord-1');
    expect(res.state).toBe('COMPLETED');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('propagates a network failure as a retryable typed error', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(tokenBody()));
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    // (retries exhaust, then the typed error surfaces)
    await expect(getOrderStatus(SANDBOX, 'ord-1')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('url-encodes the merchant order id', async () => {
    withToken(jsonRes(STATUS_OK));
    await getOrderStatus(SANDBOX, 'ord_with-chars');
    expect(fetchMock.mock.calls[1][0]).toContain('/order/ord_with-chars/status');
  });
});

describe('refunds', () => {
  it('POSTs the documented refund body', async () => {
    withToken(jsonRes({ refundId: 'OMR123', amount: 1234, state: 'PENDING' }));
    const res = await createRefund(SANDBOX, {
      merchantRefundId: 'rfnd-1',
      originalMerchantOrderId: 'ord-1',
      amountPaisa: 1234,
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/payments/v2/refund');
    expect(JSON.parse(init.body)).toEqual({
      merchantRefundId: 'rfnd-1',
      originalMerchantOrderId: 'ord-1',
      amount: 1234,
    });
    expect(res).toMatchObject({ refundId: 'OMR123', amount: 1234, state: 'PENDING' });
  });

  it('is retried on 5xx — merchantRefundId makes it idempotent upstream', async () => {
    withToken(jsonRes({ code: 'INTERNAL_SERVER_ERROR' }, 500), jsonRes({ refundId: 'OMR9', amount: 100, state: 'PENDING' }));
    const res = await createRefund(SANDBOX, { merchantRefundId: 'rfnd-2', originalMerchantOrderId: 'ord-1', amountPaisa: 100 });
    expect(res.refundId).toBe('OMR9');
  });

  it('reads refund status from the documented path', async () => {
    withToken(jsonRes({ originalMerchantOrderId: 'ord-1', amount: 100, state: 'COMPLETED', refundId: 'OMR9', timestamp: 1730869961754 }));
    const res = await getRefundStatus(SANDBOX, 'rfnd-2');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/payments/v2/refund/rfnd-2/status');
    expect(res.state).toBe('COMPLETED');
  });

  it('rejects a sub-₹1 refund locally', async () => {
    await expect(
      createRefund(SANDBOX, { merchantRefundId: 'r', originalMerchantOrderId: 'o', amountPaisa: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('merchant id + amount helpers', () => {
  it('accepts ids PhonePe allows', () => {
    expect(() => assertMerchantId('abc123', 'x')).not.toThrow();
    expect(() => assertMerchantId('a_b-c', 'x')).not.toThrow();
    expect(() => assertMerchantId('a'.repeat(63), 'x')).not.toThrow();
  });

  it('rejects ids PhonePe would 400 on, with a precise message', () => {
    expect(() => assertMerchantId('has space', 'merchantOrderId')).toThrow(/merchantOrderId/);
    expect(() => assertMerchantId('has.dot', 'x')).toThrow();
    expect(() => assertMerchantId('a'.repeat(64), 'x')).toThrow();
    expect(() => assertMerchantId('', 'x')).toThrow();
  });

  it('sanitises arbitrary ids into an acceptable shape', () => {
    expect(toMerchantId('order/with.bad chars')).toBe('order-with-bad-chars');
    expect(toMerchantId('a'.repeat(80))).toHaveLength(63);
    expect(() => assertMerchantId(toMerchantId('!!!'), 'x')).not.toThrow();
    // A cuid — the common case — must pass through untouched.
    expect(toMerchantId('cm3x9k2p40000abcd1234efgh-1')).toBe('cm3x9k2p40000abcd1234efgh-1');
  });

  it('converts rupees to paisa without float drift', () => {
    expect(toPaisa(1)).toBe(100);
    expect(toPaisa(499.99)).toBe(49999);
    expect(toPaisa(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30, not 30.000000000000004
    expect(Number.isInteger(toPaisa(1234.567))).toBe(true);
  });
});

describe('paymentModeConfig', () => {
  const PAY_OK = { orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y' };

  it('injects version V2 — without it PhonePe silently ignores the dimensional filters', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, {
      merchantOrderId: 'o-1',
      amountPaisa: 100,
      redirectUrl: 'https://x.test/r',
      paymentModeConfig: { enabledPaymentModes: [{ type: 'UPI', flows: ['INTENT'], apps: ['phonepe'] }] },
    });
    const cfgSent = JSON.parse(fetchMock.mock.calls[1][1].body).paymentFlow.paymentModeConfig;
    expect(cfgSent.version).toBe('V2');
    expect(cfgSent.enabledPaymentModes).toEqual([{ type: 'UPI', flows: ['INTENT'], apps: ['phonepe'] }]);
  });

  it('carries every documented card dimension through untouched', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, {
      merchantOrderId: 'o-2',
      amountPaisa: 100,
      redirectUrl: 'https://x.test/r',
      paymentModeConfig: {
        enabledPaymentModes: [
          { type: 'CARD', types: ['DEBIT_CARD'], networks: ['VISA'], variants: ['CONSUMER'], geoScopes: ['DOMESTIC'] },
        ],
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).paymentFlow.paymentModeConfig.enabledPaymentModes[0]).toEqual({
      type: 'CARD',
      types: ['DEBIT_CARD'],
      networks: ['VISA'],
      variants: ['CONSUMER'],
      geoScopes: ['DOMESTIC'],
    });
  });

  it('omits paymentModeConfig entirely when not supplied', async () => {
    withToken(jsonRes(PAY_OK));
    await createPayment(SANDBOX, { merchantOrderId: 'o-3', amountPaisa: 100, redirectUrl: 'https://x.test/r' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).paymentFlow).not.toHaveProperty('paymentModeConfig');
  });
});

describe('sanitizeMetaInfo', () => {
  it('keeps udf1-udf10 verbatim up to 256 chars', () => {
    expect(sanitizeMetaInfo({ udf1: 'anything: goes! /?&', udf10: 'x' })).toEqual({
      udf1: 'anything: goes! /?&',
      udf10: 'x',
    });
    expect(sanitizeMetaInfo({ udf1: 'a'.repeat(300) }).udf1).toHaveLength(256);
  });

  it('restricts udf11-udf15 to the documented charset and 50 chars', () => {
    expect(sanitizeMetaInfo({ udf11: 'ok_val-1+2@x.y' })).toEqual({ udf11: 'ok_val-1+2@x.y' });
    expect(sanitizeMetaInfo({ udf12: 'has space/slash' }).udf12).toBe('has-space-slash');
    expect(sanitizeMetaInfo({ udf15: 'b'.repeat(80) }).udf15).toHaveLength(50);
  });

  it('drops empty values and keys outside udf1-udf15', () => {
    expect(sanitizeMetaInfo({ udf1: '', udf16: 'nope', notUdf: 'nope', udf0: 'nope', udf3: 'keep' })).toEqual({
      udf3: 'keep',
    });
  });

  it('is applied by createPayment, so an over-long value cannot 400 the payment', async () => {
    withToken(jsonRes({ orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y' }));
    await createPayment(SANDBOX, {
      merchantOrderId: 'o-4',
      amountPaisa: 100,
      redirectUrl: 'https://x.test/r',
      metaInfo: { udf1: 'c'.repeat(400), udf2: '' },
    });
    const meta = JSON.parse(fetchMock.mock.calls[1][1].body).metaInfo;
    expect(meta.udf1).toHaveLength(256);
    expect(meta).not.toHaveProperty('udf2');
  });
});

describe('toPhonePePhone', () => {
  it('normalises Indian mobiles to +91 E.164', () => {
    expect(toPhonePePhone('9876543210')).toBe('+919876543210');
    expect(toPhonePePhone('+91 98765 43210')).toBe('+919876543210');
    expect(toPhonePePhone('091-9876543210')).toBe('+919876543210');
  });

  it('returns null rather than guessing — a bad value would fail the whole payment', () => {
    expect(toPhonePePhone(null)).toBeNull();
    expect(toPhonePePhone('')).toBeNull();
    expect(toPhonePePhone('12345')).toBeNull();
    expect(toPhonePePhone('5876543210')).toBeNull();      // Indian mobiles start 6-9
    expect(toPhonePePhone('+1 415 555 0134')).toBeNull(); // not an Indian mobile
  });

  it('is sent as prefillUserLoginDetails only when valid', async () => {
    withToken(jsonRes({ orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y' }));
    await createPayment(SANDBOX, {
      merchantOrderId: 'o-5', amountPaisa: 100, redirectUrl: 'https://x.test/r', customerPhone: '9876543210',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).prefillUserLoginDetails).toEqual({ phoneNumber: '+919876543210' });

    __resetPhonePeTokenCache();
    fetchMock.mockClear();
    withToken(jsonRes({ orderId: 'O', state: 'PENDING', expireAt: 0, redirectUrl: 'https://x/y' }));
    await createPayment(SANDBOX, {
      merchantOrderId: 'o-6', amountPaisa: 100, redirectUrl: 'https://x.test/r', customerPhone: 'not-a-number',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('prefillUserLoginDetails');
  });
});

describe('phonePeStatusPollDelays', () => {
  it('follows the documented cadence: 20s, then 3s x10, 6s x10, 10s x6, 30s x2', () => {
    const d = phonePeStatusPollDelays({ maxTotalMs: 0 });
    expect(d[0]).toBe(20_000);
    expect(d.filter((x) => x === 3_000)).toHaveLength(10);
    expect(d.filter((x) => x === 6_000)).toHaveLength(10);
    expect(d.filter((x) => x === 10_000)).toHaveLength(6);
    expect(d.filter((x) => x === 30_000)).toHaveLength(2);
  });

  it('skipInitialWait drops the opening 20s — the return route already checked once', () => {
    const d = phonePeStatusPollDelays({ skipInitialWait: true, maxTotalMs: 0 });
    expect(d[0]).toBe(3_000);
    expect(d).not.toContain(20_000);
  });

  it('pads with 60s steps up to the ceiling and never returns an empty schedule', () => {
    const d = phonePeStatusPollDelays({ maxTotalMs: 10 * 60_000 });
    expect(d.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10 * 60_000);
    expect(d.filter((x) => x === 60_000).length).toBeGreaterThan(0);
    expect(phonePeStatusPollDelays({ maxTotalMs: 0 }).length).toBeGreaterThan(0);
  });

  it('never polls faster than 3s — the floor PhonePe prescribes', () => {
    expect(Math.min(...phonePeStatusPollDelays())).toBeGreaterThanOrEqual(3_000);
  });
});
