import { describe, it, expect, vi, afterEach } from 'vitest';
import { createYoupiPayment, getYoupiStatus, type YoupiConfig } from '@/server/payments/youpi-api';

const cfg: YoupiConfig = { baseUrl: 'http://youpi.local:6100', apiKey: 'sk_secret_123' };

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('createYoupiPayment', () => {
  it('returns paymentId + checkoutUrl and sends Bearer auth', async () => {
    const spy = mockFetch(200, { paymentId: 'p1', checkoutUrl: 'http://pay/p1' });
    const r = await createYoupiPayment(cfg, { orderId: 'o1', amountPaise: 12300 });
    expect(r).toEqual({ paymentId: 'p1', checkoutUrl: 'http://pay/p1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/payments/create');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_secret_123');
    expect(JSON.parse(init.body as string)).toMatchObject({ orderId: 'o1', amountPaise: 12300 });
    expect(init.signal).toBeDefined();
  });

  it('accepts alternate field names', async () => {
    mockFetch(200, { id: 'p2', checkout_url: 'http://pay/p2' });
    expect(await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 })).toEqual({
      paymentId: 'p2',
      checkoutUrl: 'http://pay/p2',
    });
  });

  it('throws on 500 with the apiKey masked and message <= 200 chars', async () => {
    mockFetch(500, `boom echo ${cfg.apiKey} ${'x'.repeat(500)}`);
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(cfg.apiKey);
    expect(err.message).toContain('***');
    expect(err.message.length).toBeLessThanOrEqual(200);
  });

  it('masks the apiKey even when the key straddles the slice boundary', async () => {
    mockFetch(500, `${'y'.repeat(190)}${cfg.apiKey}`);
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err.message).not.toContain(cfg.apiKey);
    expect(err.message).not.toContain('sk_secret');
  });

  it('throws when response lacks paymentId/checkoutUrl, key masked', async () => {
    mockFetch(200, { note: cfg.apiKey });
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(cfg.apiKey);
  });

  it('masks apiKey in network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`connect failed ${cfg.apiKey}`));
    const err = await createYoupiPayment(cfg, { orderId: 'o', amountPaise: 1 }).catch((e) => e);
    expect(err.message).not.toContain(cfg.apiKey);
  });
});

describe('getYoupiStatus', () => {
  it.each([
    ['success', 'CAPTURED'],
    ['failed', 'FAILED'],
    ['cancelled', 'FAILED'],
    ['pending', 'PENDING'],
    ['processing', 'PENDING'],
    ['queued', 'PENDING'],
    ['suspicious', 'UNKNOWN'],
    ['expired', 'UNKNOWN'],
    ['weird', 'UNKNOWN'],
  ])('maps %s -> %s', async (outcome, expected) => {
    mockFetch(200, { status: outcome });
    expect((await getYoupiStatus(cfg, 'p1')).status).toBe(expected);
  });

  it('GETs the status URL with Bearer auth and extracts utr + amountPaise', async () => {
    const spy = mockFetch(200, { status: 'SUCCESS', utr: 'U123', amountPaise: 5000 });
    const r = await getYoupiStatus(cfg, 'p1');
    expect(r).toEqual({ status: 'CAPTURED', utr: 'U123', amountPaise: 5000 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://youpi.local:6100/api/payments/p1/status');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_secret_123');
  });

  it('returns UNKNOWN (no throw) on 500', async () => {
    mockFetch(500, `err ${cfg.apiKey}`);
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
