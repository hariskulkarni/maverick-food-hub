/**
 * Middleware: a CUSTOMER whose session says the phone is NOT verified is sent
 * to the mandatory phone step (with the return path) on protected customer
 * pages; verified customers and tokens without the flag pass through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('next-auth', () => ({ default: () => ({ auth: h.auth }) }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));

import { middleware } from '@/middleware';

const req = (url: string) => new NextRequest(url);
const customer = (phoneVerified?: boolean) => ({ user: { id: 'c1', role: 'CUSTOMER', phoneVerified } });

beforeEach(() => h.auth.mockReset());

describe('customer phone gate (middleware)', () => {
  it('redirects an unverified customer to /welcome with next + gate', async () => {
    h.auth.mockResolvedValue(customer(false));
    const res = await middleware(req('http://localhost:3000/orders/abc?x=1'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/welcome');
    expect(loc.searchParams.get('next')).toBe('/orders/abc?x=1');
    expect(loc.searchParams.get('gate')).toBe('1');
  });
  it('gates /profile too', async () => {
    h.auth.mockResolvedValue(customer(false));
    const res = await middleware(req('http://localhost:3000/profile'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/welcome');
  });
  it('lets a verified customer through', async () => {
    h.auth.mockResolvedValue(customer(true));
    const res = await middleware(req('http://localhost:3000/orders'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('lets a token minted before the flag existed through (server re-checks)', async () => {
    h.auth.mockResolvedValue(customer(undefined));
    const res = await middleware(req('http://localhost:3000/orders'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('never applies to staff', async () => {
    h.auth.mockResolvedValue({ user: { id: 'k1', role: 'KITCHEN', phoneVerified: false } });
    const res = await middleware(req('http://localhost:3000/orders'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('leaves the welcome page itself and the menu unauthenticated-friendly', async () => {
    h.auth.mockResolvedValue(customer(false));
    for (const p of ['/welcome', '/r/spice', '/restaurants']) {
      const res = await middleware(req(`http://localhost:3000${p}`));
      expect(res.headers.get('location')).toBeNull();
    }
  });
});
