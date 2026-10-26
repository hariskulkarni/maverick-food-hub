import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createYoupiSession,
  findYoupiPaymentByOrderId,
  getYoupiStatus,
  readYoupiPayment,
  type YoupiConfig,
} from '@/server/payments/youpi-api';

// Obviously fake values. webhookSecret doubles as the X-Merchant-Key unless merchantKey is set.
const cfg: YoupiConfig = { baseUrl: 'http://youpi.local:6100', merchantId: 'mrc_123', webhookSecret: 'sk_secret_123' };

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('createYoupiSession', () => {
  it('posts to /api/v1/payments with X-Merchant-Id, X-Merchant-Key, INR amount and idempotency key', async () => {
    const spy = mockFetch(201, { paymentId: 'p1', checkoutUrl: 'http://pay/p1' });
    const r = await createYoupiSession(cfg, { orderId: 'o1-cabc', amountPaise: 12305 });
    expect(r).toEqual({ kind: 'created', paymentId: 'p1', checkoutUrl: 'http://pay/p1', httpStatus: 201 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/payments');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Merchant-Id']).toBe('mrc_123');
    expect(headers['X-Merchant-Key']).toBe(cfg.webhookSecret);
    expect(headers['Idempotency-Key']).toBe('o1-cabc');
    expect(headers.authorization).toBeUndefined(); // no Bearer auth upstream
    // Amount goes as an exact INR string (no float maths), not paise.
    expect(JSON.parse(init.body as string)).toMatchObject({ orderId: 'o1-cabc', amount: '123.05', currency: 'INR' });
    expect(init.signal).toBeDefined();
    expect(init.redirect).toBe('error'); // never forward X-Merchant-Key across a redirect
  });

  it('uses a separately rotated merchant API key when configured', async () => {
    const spy = mockFetch(201, { paymentId: 'p1', checkoutUrl: 'https://pay.example/p1' });
    await createYoupiSession({ ...cfg, merchantKey: 'dedicated-merchant-key' }, { orderId: 'o1-2', amountPaise: 500 });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Merchant-Key']).toBe('dedicated-merchant-key');
  });

  it('a 200 (existing session for the same attemptKey) counts as created', async () => {
    mockFetch(200, { paymentId: 'p2', checkoutUrl: 'http://pay/p2', activeSessionDetected: true });
    expect(await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 })).toMatchObject({ kind: 'created', paymentId: 'p2' });
  });

  it.each([400, 401, 403, 422, 429])('HTTP %s is a definitive rejection', async (status) => {
    mockFetch(status, { error: 'nope' });
    expect(await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 })).toMatchObject({ kind: 'rejected', httpStatus: status });
  });

  it.each([408, 409, 500, 502, 503])('HTTP %s is an unknown outcome (session may exist)', async (status) => {
    mockFetch(status, 'x');
    expect(await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 })).toMatchObject({ kind: 'unknown', httpStatus: status });
  });

  it('timeout / network error is an unknown outcome, secret masked', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`The operation was aborted ${cfg.webhookSecret}`));
    const r = await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 });
    expect(r.kind).toBe('unknown');
    expect(JSON.stringify(r)).not.toContain(cfg.webhookSecret);
  });

  it('2xx without paymentId/checkoutUrl is unknown, secret masked', async () => {
    mockFetch(200, { note: cfg.webhookSecret });
    const r = await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 });
    expect(r.kind).toBe('unknown');
    expect(JSON.stringify(r)).not.toContain(cfg.webhookSecret);
  });

  it('masks both secrets and caps the message at 200 chars', async () => {
    const c = { ...cfg, merchantKey: 'mk_secret_456' };
    mockFetch(500, `boom ${c.webhookSecret} ${c.merchantKey} ${'x'.repeat(500)}`);
    const r = await createYoupiSession(c, { orderId: 'o', amountPaise: 1 });
    if (r.kind === 'created') throw new Error('unexpected');
    expect(r.error).not.toContain(c.webhookSecret);
    expect(r.error).not.toContain(c.merchantKey);
    expect(r.error).toContain('***');
    expect(r.error.length).toBeLessThanOrEqual(200);
  });

  it('masks the secret even when it straddles the slice boundary', async () => {
    mockFetch(500, `${'y'.repeat(170)}${cfg.webhookSecret}`);
    const r = await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1 });
    expect(JSON.stringify(r)).not.toContain('sk_secret');
  });

  it('rejects a non-integer paise amount without calling the gateway', async () => {
    const spy = mockFetch(201, {});
    expect((await createYoupiSession(cfg, { orderId: 'o', amountPaise: 1.5 })).kind).toBe('rejected');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('readYoupiPayment / findYoupiPaymentByOrderId', () => {
  const priv = {
    paymentId: 'p1', orderId: 'o1-cabc', amountPaise: '50000', currency: 'INR', status: 'INITIATED',
    metadata: { receivingAccountSnapshot: { upiId: ' Shop@Bank ' } },
  };

  it('reads the private view by paymentId with the merchant key', async () => {
    const spy = mockFetch(200, priv);
    const r = await readYoupiPayment({ ...cfg, merchantKey: 'mk' }, 'p1');
    expect(r).toEqual({
      kind: 'found',
      view: { paymentId: 'p1', orderId: 'o1-cabc', amountPaise: 50000, currency: 'INR', gatewayStatus: 'INITIATED', status: 'PENDING', receiverVpa: 'shop@bank', utr: null },
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/payments/p1');
    expect((init.headers as Record<string, string>)['X-Merchant-Key']).toBe('mk');
    expect(init.redirect).toBe('error');
  });

  it('looks a session up by attemptKey with merchant id + key; 404 = not_found', async () => {
    const spy = mockFetch(404, { error: 'Order not found' });
    expect(await findYoupiPaymentByOrderId(cfg, 'o1-c/x')).toEqual({ kind: 'not_found' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/orders/o1-c%2Fx/cod');
    expect((init.headers as Record<string, string>)['X-Merchant-Id']).toBe('mrc_123');
    expect((init.headers as Record<string, string>)['X-Merchant-Key']).toBe(cfg.webhookSecret);
  });

  it('5xx and network errors are errors, never not_found', async () => {
    mockFetch(503, 'down');
    expect((await findYoupiPaymentByOrderId(cfg, 'o')).kind).toBe('error');
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    expect((await readYoupiPayment(cfg, 'p')).kind).toBe('error');
  });

  it('never rounds a fractional or junk amountPaise', async () => {
    mockFetch(200, { ...priv, amountPaise: '500.4' });
    const r = await readYoupiPayment(cfg, 'p1');
    expect(r.kind === 'found' && r.view.amountPaise).toBeNull();
  });
});

describe('getYoupiStatus', () => {
  it.each([
    ['SUCCESS', 'OBSERVED'],
    ['success', 'OBSERVED'],
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'FAILED'],
    ['EXPIRED', 'FAILED'],
    ['INITIATED', 'PENDING'],
    ['ACTIVE', 'PENDING'],
    ['QUEUED', 'PENDING'],
    ['PROCESSING', 'PENDING'],
    ['weird', 'UNKNOWN'],
  ])('maps %s -> %s (SUCCESS is never CAPTURED)', async (status, expected) => {
    mockFetch(200, { status });
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe(expected);
  });

  it('uses merchantKey when set, and returns order/currency/receiver/raw status', async () => {
    const spy = mockFetch(200, {
      status: 'SUCCESS', orderId: 'o1-c', currency: 'INR', amountPaise: '5000',
      metadata: { receivingAccountSnapshot: { upiId: 'shop@bank' } },
    });
    const r = await getYoupiStatus({ ...cfg, merchantKey: 'mk_distinct' }, 'p1');
    expect(r).toEqual({
      status: 'OBSERVED', gatewayStatus: 'SUCCESS', orderId: 'o1-c', currency: 'INR',
      receiverVpa: 'shop@bank', utr: null, amountPaise: 5000,
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/payments/p1');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Merchant-Key']).toBe('mk_distinct');
    expect(headers.authorization).toBeUndefined();
  });

  it('falls back to webhookSecret as the merchant key', async () => {
    const spy = mockFetch(200, { status: 'INITIATED' });
    await getYoupiStatus(cfg, 'p1');
    expect(((spy.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)['X-Merchant-Key']).toBe('sk_secret_123');
  });

  it('returns UNKNOWN (no throw) on 500, garbage body or network failure', async () => {
    mockFetch(500, `err ${cfg.webhookSecret}`);
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
    vi.restoreAllMocks();
    mockFetch(200, 'not json <<<');
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
  });
});
