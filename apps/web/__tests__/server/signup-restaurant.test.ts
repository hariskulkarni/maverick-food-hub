/**
 * C8 — the public restaurant-signup route must not overwrite an existing user.
 *
 * Previously `if (existing && existing.role !== Role.ADMIN) return 409` let an
 * existing ADMIN fall through to `prisma.user.update(... passwordHash ...)`, so
 * an unauthenticated POST with any restaurant admin's email silently replaced
 * their password hash — full account takeover. A second restaurant for an
 * existing admin is an authenticated operation (the platform wizard), never a
 * public signup, so the route must 409 whenever the email already exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let usersByEmail: Record<string, any> = {};

vi.mock('@/server/http/rate-limit', () => ({
  rateLimit: async () => ({ ok: true })
}));
vi.mock('argon2', () => ({
  default: { hash: async () => 'argon2-hash-of-attacker-password' }
}));
vi.mock('@/server/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: any) => usersByEmail[where.email] ?? null,
      update: async ({ where }: any) => {
        calls.push('user.update:' + where.id);
        return { id: where.id, role: 'ADMIN' };
      },
      create: async ({ data }: any) => {
        calls.push('user.create');
        return { id: 'u_new', ...data };
      }
    },
    restaurant: {
      findUnique: async () => null,
      create: async ({ data }: any) => ({
        id: 'r1',
        status: data.status,
        slug: data.slug,
        branches: [{ id: 'b1', slug: 'b1' }]
      })
    },
    category: { create: async () => ({ id: 'c1', slug: 'cat-specials' }) },
    menuItem: { create: async () => ({}) }
  }
}));

import { POST } from '@/app/api/signup/restaurant/route';

const body = (email: string) => ({
  ownerName: 'Someone',
  ownerEmail: email,
  ownerPassword: 'attacker-chosen-pass',
  restaurantName: 'New Place',
  branchName: 'Main',
  line1: '12 Street',
  city: 'BLR',
  postalCode: '560001'
});

const post = (email: string) =>
  POST(
    new Request('http://x/api/signup/restaurant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body(email))
    }) as any
  );

beforeEach(() => {
  calls.length = 0;
  usersByEmail = {};
});

describe('C8: public restaurant signup', () => {
  it('returns 409 and does NOT update an existing ADMIN password', async () => {
    usersByEmail['admin@victim.com'] = { id: 'victim', email: 'admin@victim.com', role: 'ADMIN' };
    const res = await post('admin@victim.com');
    expect(res.status).toBe(409);
    expect(calls).not.toContain('user.update:victim');
  });

  it('still rejects an email already used by a non-admin role (409)', async () => {
    usersByEmail['cust@x.com'] = { id: 'c1', email: 'cust@x.com', role: 'CUSTOMER' };
    const res = await post('cust@x.com');
    expect(res.status).toBe(409);
  });

  it('creates a brand-new owner for an unused email', async () => {
    const res = await post('fresh@owner.com');
    expect(res.status).toBe(200);
    expect(calls).toContain('user.create');
  });
});
