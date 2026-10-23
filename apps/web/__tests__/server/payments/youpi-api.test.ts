import { describe, it, expect, vi, afterEach } from 'vitest';
import { createYoupiPayment, getYoupiStatus, type YoupiConfig } from '@/server/payments/youpi-api';

// webhookSecret doubles as the X-Merchant-Key and is the only secret in a request.
const cfg: YoupiConfig = { baseUrl: 'http://youpi.local:6100', merchantId: 'mrc_123', webhookSecret: 'sk_secret_123' };

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('createYoupiPayment', () => {
  it('posts to /api/v1/payments with X-Merchant-Id, INR amount and idempotency key', async () => {
    const spy = mockFetch(201, { paymentId: 'p1', checkoutUrl: 'http://pay/p1' });
    const r = await createYoupiPayment(cfg, { orderId: 'o1', amountPaise: 12300 });
    expect(r).toEqual({ paymentId: 'p1', checkoutUrl: 'http://pay/p1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/payments');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Merchant-Id']).toBe('mrc_123');
    expect(headers['X-Merchant-Key']).toBe(cfg.webhookSecret);
    expect(headers['Idempotency-Key']).toBe('o1');
    expect(headers.authorization).toBeUndefined(); // Flavrly PG has no Bearer auth
    // Amount goes as an INR string, not paise.
    expect(JSON.parse(init.body as string)).toMatchObject({ orderId: 'o1', amount: '123.00', currency: 'INR' });
    expect(init.signal).toBeDefined();
  });

  it('uses a separately rotated merchant API key when configured', async () => {
    const spy = mockFetch(201, { paymentId: 'p1', checkoutUrl: 'https://pay.example/p1' });
    await createYoupiPayment({ ...cfg, merchantKey: 'dedicated-merchant-key' }, { orderId: 'o1-2', amountPaise: 500 });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Merchant-Key']).toBe('dedicated-merchant-key');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('o1-2');
  });

  it('requires an exact private receiver snapshot before returning a production checkout', async () => {
    const prev = process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
    process.env.FLAVRLY_PG_CHECKOUT_ORIGIN = 'https://pay.flavrly.in';
    try {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ paymentId: 'p1', checkoutUrl: 'https://pay.flavrly.in/checkout/p1' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          orderId: 'o1', amountPaise: '50000', currency: 'INR',
          metadata: { receivingAccountSnapshot: { upiId: 'right@bank' } },
        }), { status: 200 }));
      expect(await createYoupiPayment({ ...cfg, receivingVpa: 'right@bank', requireReceiverMatch: true }, {
        orderId: 'o1', amountPaise: 50000,
      })).toMatchObject({ paymentId: 'p1' });
    } finally {
      if (prev === undefined) delete process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
      else process.env.FLAVRLY_PG_CHECKOUT_ORIGIN = prev;
    }
  });

  it('fails closed when a checkout is bound to the wrong receiving account', async () => {
    const prior = process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
    process.env.FLAVRLY_PG_CHECKOUT_ORIGIN = 'https://pay.flavrly.in';
    try {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ paymentId: 'p1', checkoutUrl: 'https://pay.flavrly.in/checkout/p1' }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          orderId: 'o1', amountPaise: '50000', currency: 'INR',
          metadata: { receivingAccountSnapshot: { upiId: 'different@bank' } },
        }), { status: 200 }));
      await expect(createYoupiPayment({ ...cfg, receivingVpa: 'right@bank', requireReceiverMatch: true }, {
        orderId: 'o1', amountPaise: 50000,
      })).rejects.toThrow(/receiver/);
    } finally {
      if (prior === undefined) delete process.env.FLAVRLY_PG_CHECKOUT_ORIGIN;
      else process.env.FLAVRLY_PG_CHECKOUT_ORIGIN = prior;
    }
  });

  it('accepts a 200 (existing idempotent session) response', async () => {
    mockFetch(200, { paymentId: 'p2', checkoutUrl: 'http://pay/p2' });
    expect(await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 })).toEqual({
      paymentId: 'p2',
      checkoutUrl: 'http://pay/p2',
    });
  });

  it('throws on 500 with the secret masked and message <= 200 chars', async () => {
    mockFetch(500, `boom echo ${cfg.webhookSecret} ${'x'.repeat(500)}`);
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(cfg.webhookSecret);
    expect(err.message).toContain('***');
    expect(err.message.length).toBeLessThanOrEqual(200);
  });

  it('masks the secret even when it straddles the slice boundary', async () => {
    mockFetch(500, `${'y'.repeat(190)}${cfg.webhookSecret}`);
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err.message).not.toContain(cfg.webhookSecret);
    expect(err.message).not.toContain('sk_secret');
  });

  it('throws when response lacks paymentId/checkoutUrl, secret masked', async () => {
    mockFetch(200, { note: cfg.webhookSecret });
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(cfg.webhookSecret);
  });

  it('masks the secret in network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`connect failed ${cfg.webhookSecret}`));
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err.message).not.toContain(cfg.webhookSecret);
  });
});

describe('getYoupiStatus', () => {
  it.each([
    ['SUCCESS', 'CAPTURED'],
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'FAILED'],
    ['EXPIRED', 'FAILED'],
    ['INITIATED', 'PENDING'],
    ['ACTIVE', 'PENDING'],
    ['QUEUED', 'PENDING'],
    ['PROCESSING', 'PENDING'],
    ['weird', 'UNKNOWN'],
  ])('maps %s -> %s', async (status, expected) => {
    mockFetch(200, { status });
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe(expected);
  });

  it('GETs /api/v1/payments/{id} with X-Merchant-Key and extracts amountPaise (string ok)', async () => {
    const spy = mockFetch(200, { status: 'SUCCESS', utr: 'U123', amountPaise: '5000' });
    const r = await getYoupiStatus(cfg, 'p1');
    expect(r).toEqual({ status: 'CAPTURED', utr: 'U123', amountPaise: 5000 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/v1/payments/p1');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Merchant-Key']).toBe('sk_secret_123');
    expect(headers.authorization).toBeUndefined();
  });

  it('returns UNKNOWN (no throw) on 500', async () => {
    mockFetch(500, `err ${cfg.webhookSecret}`);
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN on garbage body', async () => {
    mockFetch(200, 'not json <<<');
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe('UNKNOWN');
  });
});
