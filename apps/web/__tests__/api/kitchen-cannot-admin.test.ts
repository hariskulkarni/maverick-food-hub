/**
 * P0-1 / P0-2 / P1-4: a KITCHEN member calling admin-only APIs directly gets a
 * 403 and touches nothing. Uses the REAL tenancy gate; the db stub only answers
 * the membership lookups and throws on any other access, proving no write (or
 * read of tenant data) happens before the gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ session: null as any, role: 'KITCHEN' as 'KITCHEN' | 'ADMIN' }));

vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock('@/server/db', () => {
  const allowed: Record<string, any> = {
    restaurantUser: {
      findMany: async () => [{ restaurantId: 'A', role: h.role, restaurant: { id: 'A', name: 'A', parentId: null } }],
    },
    restaurant: { findMany: async () => [] },
  };
  const prisma = new Proxy({}, {
    get(_t, model: string) {
      if (allowed[model]) return allowed[model];
      return new Proxy({}, { get(_x, op: string) { return () => { throw new Error(`unexpected db access ${model}.${op}`); }; } });
    },
  });
  return { prisma, db: prisma };
});

const req = (body: unknown = {}, url = 'http://x/api/admin/x') => {
  const u = new URL(url);
  return Object.assign(new Request(u, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { nextUrl: u }) as any;
};
const ctx = (params: Record<string, string>): any => ({ params: Promise.resolve(params) });

beforeEach(() => {
  h.session = { user: { id: 'k1', role: 'ADMIN' } }; // global ADMIN…
  h.role = 'KITCHEN'; // …holding only a KITCHEN grant on the active restaurant
});

describe('KITCHEN membership is refused on admin-only routes', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['PUT integrations/RAZORPAY', async () => (await import('@/app/api/admin/integrations/[provider]/route')).PUT(req({ config: { keyId: 'x' } }), ctx({ provider: 'RAZORPAY' }))],
    ['DELETE integrations/SMTP', async () => (await import('@/app/api/admin/integrations/[provider]/route')).DELETE(req(), ctx({ provider: 'SMTP' }))],
    ['POST integrations test', async () => (await import('@/app/api/admin/integrations/[provider]/test/route')).POST(req({ config: {} }), ctx({ provider: 'RAZORPAY' }))],
    ['POST youpi/vpa', async () => (await import('@/app/api/admin/youpi/vpa/route')).POST(req({ vpa: 'x@ybl' }))],
    ['POST youpi/request', async () => (await import('@/app/api/admin/youpi/request/route')).POST()],
    ['POST coupons', async () => (await import('@/app/api/admin/coupons/route')).POST(req({ code: 'X', percentOff: 10 }))],
    ['PATCH coupons/[id]', async () => (await import('@/app/api/admin/coupons/[id]/route')).PATCH(req({ isActive: false }), ctx({ id: 'c1' }))],
    ['PATCH settings/branch/[id]', async () => (await import('@/app/api/admin/settings/branch/[id]/route')).PATCH(req({}), ctx({ id: 'b1' }))],
    ['POST branches', async () => (await import('@/app/api/admin/branches/route')).POST(req({ name: 'B' }))],
    ['PATCH storefront', async () => (await import('@/app/api/admin/storefront/route')).PATCH(req({}))],
    ['PATCH settings/order-flow', async () => (await import('@/app/api/admin/settings/order-flow/route')).PATCH(req({}))],
    ['POST rider-applications approve', async () => (await import('@/app/api/admin/rider-applications/[id]/approve/route')).POST(req({}), ctx({ id: 'a1' }))],
    ['POST reviews/places/connect', async () => (await import('@/app/api/admin/reviews/places/connect/route')).POST(req({ placeId: 'p', name: 'n' }))],
    ['GET reports/cancelled-orders', async () => (await import('@/app/api/admin/reports/cancelled-orders/route')).GET(req({}, 'http://x/api/admin/reports/cancelled-orders'))],
    ['POST branch pause', async () => (await import('@/app/api/admin/branch/[id]/pause/route')).POST(req({ minutes: 15 }), ctx({ id: 'b1' }))],
    ['POST branch unpause', async () => (await import('@/app/api/admin/branch/[id]/unpause/route')).POST(req({}), ctx({ id: 'b1' }))],
    ['GET notifications', async () => (await import('@/app/api/admin/notifications/route')).GET(req({}, 'http://x/api/admin/notifications'))],
    ['GET reports/orders.csv', async () => (await import('@/app/api/admin/reports/orders.csv/route')).GET(req({}, 'http://x/api/admin/reports/orders.csv'))],
  ];

  it.each(cases)('%s → 403', async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(403);
  });
});
