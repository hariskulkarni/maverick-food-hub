/**
 * Novaryq partner-API client: HMAC signing exactly per CONTRACT §1, timeouts,
 * 429 Retry-After, retryable vs permanent error classification, base-URL guard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  signRequest,
  novaryqRequest,
  NovaryqApiError,
  parseRetryAfterMs,
  normalizeBaseUrl,
  checkBaseUrl,
} from '@/server/novaryq/client';

const cfg = { baseUrl: 'https://pos.example.com', clientId: 'nq_test_abc', secret: 'nqsec_123' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signRequest (CONTRACT §1)', () => {
  it('is hex(HMAC_SHA256(key = sha256hex(secret), `${ts}.${rawBody}`))', () => {
    const key = createHash('sha256').update('nqsec_123').digest('hex');
    const expected = createHmac('sha256', key).update('1761390000.{"a":1}').digest('hex');
    expect(signRequest('nqsec_123', '{"a":1}', 1761390000)).toBe(expected);
  });

  it('signs an empty body for GET and differs from the raw-secret HMAC', () => {
    const raw = createHmac('sha256', 'nqsec_123').update('1761390000.').digest('hex');
    const sig = signRequest('nqsec_123', '', 1761390000);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).not.toBe(raw);
  });
});

describe('novaryqRequest', () => {
  it('sends x-api-key, x-timestamp (seconds) and the signature over the exact raw body', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      const ts = Number(h.get('x-timestamp'));
      expect(String(ts)).toMatch(/^\d{10}$/);
      expect(h.get('x-api-key')).toBe('nq_test_abc');
      expect(h.get('x-signature')).toBe(signRequest('nqsec_123', String(init.body), ts));
      return new Response(JSON.stringify({ id: 'o1' }), { status: 201 });
    });
    const res = await novaryqRequest(cfg, 'POST', '/orders', { a: 1 }, { fetchImpl: fetchImpl as any });
    expect(res).toEqual({ status: 201, data: { id: 'o1' } });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://pos.example.com/api/v1/orders');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });

  it('GET signs the empty string', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      expect(h.get('x-signature')).toBe(signRequest('nqsec_123', '', Number(h.get('x-timestamp'))));
      expect(init.body).toBeUndefined();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await novaryqRequest(cfg, 'GET', '/menu?locationId=loc_1', undefined, { fetchImpl: fetchImpl as any });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://pos.example.com/api/v1/menu?locationId=loc_1');
  });

  it('429 → retryable error carrying Retry-After in ms', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'Retry-After': '42' } }));
    const err = await novaryqRequest(cfg, 'GET', '/menu', undefined, { fetchImpl: fetchImpl as any }).catch((e) => e);
    expect(err).toBeInstanceOf(NovaryqApiError);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(42_000);
  });

  it('5xx and network failures are retryable; 422 is permanent with the body attached', async () => {
    const e5 = await novaryqRequest(cfg, 'GET', '/menu', undefined, { fetchImpl: (async () => new Response('x', { status: 503 })) as any }).catch((e) => e);
    expect(e5.retryable).toBe(true);
    const net = await novaryqRequest(cfg, 'GET', '/menu', undefined, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as any }).catch((e) => e);
    expect(net).toBeInstanceOf(NovaryqApiError);
    expect(net.status).toBeNull();
    expect(net.retryable).toBe(true);
    const body = { statusCode: 422, message: 'Unknown item codes', unknownItemCodes: ['A', 'B'] };
    const e422 = await novaryqRequest(cfg, 'POST', '/orders', {}, { fetchImpl: (async () => new Response(JSON.stringify(body), { status: 422 })) as any }).catch((e) => e);
    expect(e422.retryable).toBe(false);
    expect(e422.body).toEqual(body);
    expect(e422.message).toContain('Unknown item codes');
  });

  it('times out (abort) as a retryable error', async () => {
    const fetchImpl = (_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    const err = await novaryqRequest(cfg, 'GET', '/menu', undefined, { fetchImpl: fetchImpl as any, timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(NovaryqApiError);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/timed out/i);
  });

  it('a redirect is never followed and is not retried', async () => {
    const err = await novaryqRequest(cfg, 'GET', '/menu', undefined, {
      fetchImpl: (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as any,
    }).catch((e) => e);
    expect(err.status).toBe(302);
    expect(err.retryable).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds, HTTP dates and the JSON retryAfterSec', () => {
    expect(parseRetryAfterMs('7', null)).toBe(7000);
    const at = new Date(Date.now() + 60_000).toUTCString();
    expect(parseRetryAfterMs(at, null)!).toBeGreaterThan(50_000);
    expect(parseRetryAfterMs(null, { retryAfterSec: 3 })).toBe(3000);
    expect(parseRetryAfterMs(null, null)).toBeNull();
  });
});

describe('base URL guard', () => {
  it('normalizes to the origin (drops trailing slash and /api/v1)', () => {
    expect(normalizeBaseUrl('https://pos.example.com/')).toBe('https://pos.example.com');
    expect(normalizeBaseUrl('https://pos.example.com/api/v1/')).toBe('https://pos.example.com');
  });

  it('requires https and a public host', async () => {
    expect(await checkBaseUrl('http://pos.example.com', { resolve: async () => ['93.184.216.34'] })).toMatch(/https/);
    expect(await checkBaseUrl('https://localhost:4000', { resolve: async () => ['127.0.0.1'] })).toMatch(/public/);
    expect(await checkBaseUrl('https://10.0.0.5', { resolve: async () => ['10.0.0.5'] })).toMatch(/public/);
    expect(await checkBaseUrl('https://pos.example.com', { resolve: async () => ['192.168.1.4'] })).toMatch(/public/);
    expect(await checkBaseUrl('https://user:pw@pos.example.com', { resolve: async () => ['93.184.216.34'] })).toMatch(/credentials/);
    expect(await checkBaseUrl('not a url', { resolve: async () => [] })).toMatch(/valid/);
    expect(await checkBaseUrl('https://pos.example.com', { resolve: async () => ['93.184.216.34'] })).toBeNull();
  });

  it('NOVARYQ_ALLOW_INSECURE_BASE_URL=true (dev/QA only) admits http://localhost', async () => {
    vi.stubEnv('NOVARYQ_ALLOW_INSECURE_BASE_URL', 'true');
    expect(await checkBaseUrl('http://localhost:4010', { resolve: async () => ['127.0.0.1'] })).toBeNull();
  });
});
