/**
 * Middleware page gates: the demo gate verifies its cookie on every request
 * (the path only decides whether a bad cookie is tolerated), and the portal
 * root redirect picks the dashboard from the session role.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('next-auth', () => ({ default: () => ({ auth: h.auth }) }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));

import { middleware } from '@/middleware';

const req = (url: string, host?: string) =>
  new NextRequest(url, { headers: host ? { host, 'x-forwarded-proto': 'https' } : {} });

beforeEach(() => {
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
});

describe('demo gate (DEMO_MODE=true)', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('DEMO_GATE_SECRET', 'test-only-demo-gate-secret');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('redirects a page request without a valid gate cookie to /demo-gate', async () => {
    const res = await middleware(req('http://localhost:3000/r/some-restaurant'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/demo-gate');
  });

  it('rejects a forged gate cookie', async () => {
    const r = req('http://localhost:3000/r/some-restaurant');
    r.cookies.set('flavrly_demo_gate', 'eyJleHAiOjk5OTk5OTk5OTl9.forged-signature');
    const res = await middleware(r);
    expect(res.headers.get('location')).toBe('http://localhost:3000/demo-gate');
  });

  it('serves a page when the gate cookie is validly signed and unexpired', async () => {
    const head = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const sig = createHmac('sha256', 'test-only-demo-gate-secret').update(head).digest('base64url');
    const r = req('http://localhost:3000/r/some-restaurant');
    r.cookies.set('flavrly_demo_gate', `${head}.${sig}`);
    const res = await middleware(r);
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets the gate page and static assets through without a cookie', async () => {
    for (const p of ['/demo-gate', '/_next/static/chunk.js', '/uploads/a.webp', '/favicon.ico']) {
      const res = await middleware(req(`http://localhost:3000${p}`));
      expect(res.headers.get('location')).toBeNull();
    }
  });
});

describe('portal root redirect', () => {
  it.each([
    ['ADMIN', 'https://portal.flavrly.in/admin'],
    ['KITCHEN', 'https://portal.flavrly.in/kitchen'],
    ['SUPER_ADMIN', 'https://portal.flavrly.in/platform'],
    ['CUSTOMER', 'https://portal.flavrly.in/login'],
  ])('sends a %s session to %s', async (role, target) => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role } });
    const res = await middleware(req('https://portal.flavrly.in/', 'portal.flavrly.in'));
    expect(res.headers.get('location')).toBe(target);
  });

  it('sends a signed-out visitor to the staff login', async () => {
    const res = await middleware(req('https://portal.flavrly.in/', 'portal.flavrly.in'));
    expect(res.headers.get('location')).toBe('https://portal.flavrly.in/login');
  });
});
