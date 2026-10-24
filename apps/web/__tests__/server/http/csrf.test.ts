import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { csrfGuard, isWebhookPath } from '@/server/http/csrf';

const HOST = 'flavrly.example';

function req(method: string, path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${HOST}${path}`, { method, headers: { host: HOST, ...headers } });
}
const run = (method: string, path: string, headers: Record<string, string> = {}) =>
  csrfGuard(req(method, path, headers), path);

describe('csrfGuard (T-16)', () => {
  it('allows safe methods even when cross-site', () => {
    expect(run('GET', '/api/orders', { 'sec-fetch-site': 'cross-site' })).toBeNull();
    expect(run('HEAD', '/api/orders', { 'sec-fetch-site': 'cross-site' })).toBeNull();
    expect(run('OPTIONS', '/api/orders', { 'sec-fetch-site': 'cross-site' })).toBeNull();
  });

  it('blocks a cross-site cookie POST with no Origin header', () => {
    const res = run('POST', '/api/admin/settings', { cookie: 'session=x', 'sec-fetch-site': 'cross-site' });
    expect(res?.status).toBe(403);
  });

  it('blocks cross-site with an unparseable Origin (e.g. Origin: null)', () => {
    expect(run('POST', '/api/admin/settings', { origin: 'null', 'sec-fetch-site': 'cross-site' })?.status).toBe(403);
  });

  it('blocks cross-site even when Origin claims the same host', () => {
    expect(run('PATCH', '/api/admin/settings', { origin: `https://${HOST}`, 'Sec-Fetch-Site': 'Cross-Site' })?.status).toBe(403);
  });

  it('allows same-origin, same-site and none fetch-site values when Origin matches or is absent', () => {
    expect(run('POST', '/api/orders', { origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(run('POST', '/api/orders', { 'sec-fetch-site': 'same-site' })).toBeNull();
    expect(run('POST', '/api/orders', { 'sec-fetch-site': 'none' })).toBeNull();
  });

  it('still blocks a mismatched Origin without Sec-Fetch-Site', () => {
    expect(run('DELETE', '/api/orders/1', { origin: 'https://evil.example' })?.status).toBe(403);
  });

  it('allows requests with neither Origin nor Sec-Fetch-Site (native/server clients)', () => {
    expect(run('POST', '/api/orders')).toBeNull();
  });

  it('exempts Bearer requests even when cross-site', () => {
    expect(run('POST', '/api/rider/location', { authorization: 'Bearer t', 'sec-fetch-site': 'cross-site' })).toBeNull();
  });

  it('exempts NextAuth and the exact webhook paths only', () => {
    const xs = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' };
    expect(run('POST', '/api/auth/callback/credentials', xs)).toBeNull();
    expect(run('POST', '/api/payments/youpi/webhook', xs)).toBeNull();
    expect(run('POST', '/api/payments/razorpay/webhook/', xs)).toBeNull();
    expect(run('POST', '/api/admin/webhook-settings', xs)?.status).toBe(403);
    expect(run('POST', '/api/payments/youpi/webhook/replay', xs)?.status).toBe(403);
  });

  it('isWebhookPath is exact (trailing slash tolerated)', () => {
    expect(isWebhookPath('/api/payments/phonepe/webhook')).toBe(true);
    expect(isWebhookPath('/api/payments/phonepe/webhook/')).toBe(true);
    expect(isWebhookPath('/api/x/webhook')).toBe(false);
  });
});
