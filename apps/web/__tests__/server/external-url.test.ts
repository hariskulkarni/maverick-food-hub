import { describe, it, expect, afterEach } from 'vitest';
import { externalBaseUrl } from '@/server/http/external-url';

const origEnv = { ...process.env };
afterEach(() => { process.env = { ...origEnv }; });

function h(map: Record<string, string>): Headers {
  const hh = new Headers();
  for (const [k, v] of Object.entries(map)) hh.set(k, v);
  return hh;
}

describe('externalBaseUrl', () => {
  it('uses the Host header (public host from nginx) with forwarded proto', () => {
    expect(externalBaseUrl(h({ host: 'portal.flavrly.in', 'x-forwarded-proto': 'https' })))
      .toBe('https://portal.flavrly.in');
  });

  it('prefers x-forwarded-host over host', () => {
    expect(externalBaseUrl(h({ 'x-forwarded-host': 'flavrly.in', host: 'localhost:3000', 'x-forwarded-proto': 'https' })))
      .toBe('https://flavrly.in');
  });

  it('defaults proto to https when not forwarded', () => {
    expect(externalBaseUrl(h({ host: 'portal.flavrly.in' }))).toBe('https://portal.flavrly.in');
  });

  it('NEVER redirects to a loopback host — falls back to GOOGLE_OAUTH_REDIRECT_URI origin', () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://portal.flavrly.in/api/admin/integrations/google-business/callback';
    expect(externalBaseUrl(h({ host: 'localhost:3000' }))).toBe('https://portal.flavrly.in');
  });

  it('falls back to brand url when host is loopback and no redirect env', () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://flavrly.in';
    expect(externalBaseUrl(h({ host: '127.0.0.1:3000' }))).toBe('https://flavrly.in');
  });

  it('produces a browser-reachable absolute redirect (regression: was localhost:3000)', () => {
    const base = externalBaseUrl(h({ host: 'portal.flavrly.in', 'x-forwarded-proto': 'https' }));
    const url = new URL('/admin/settings?tab=reviews&google=connected', base);
    expect(url.toString()).toBe('https://portal.flavrly.in/admin/settings?tab=reviews&google=connected');
    expect(url.hostname).not.toBe('localhost');
  });
});
