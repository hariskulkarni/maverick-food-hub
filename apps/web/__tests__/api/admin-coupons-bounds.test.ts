/** P2-14: coupon bounds + a generic message when a code is taken (by anyone). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ existing: null as any, created: [] as any[], updated: [] as any[] }));

vi.mock('@/server/tenancy', () => ({ tenantAdminOrError: async () => ({ id: 'A' }) }));
vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/db', () => ({
  prisma: {
    branch: { findFirst: async () => ({ id: 'b1' }) },
    coupon: {
      findUnique: async ({ where }: any) =>
        where.id ? { id: 'c1', code: 'OLD', flatOff: null, percentOff: 10, branch: { restaurantId: 'A' } } : h.existing,
      create: async ({ data }: any) => { h.created.push(data); return { id: 'c2', ...data }; },
      update: async ({ data }: any) => { h.updated.push(data); return { id: 'c1', ...data }; },
    },
  },
}));

import { POST } from '@/app/api/admin/coupons/route';
import { PATCH } from '@/app/api/admin/coupons/[id]/route';

const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as any;
const ctx = { params: Promise.resolve({ id: 'c1' }) };

beforeEach(() => { h.existing = null; h.created = []; h.updated = []; });

describe('coupon create bounds', () => {
  it.each([
    [{ code: 'BIG', percentOff: 150 }],
    [{ code: 'NEG', flatOff: -50 }],
    [{ code: 'ZERO', percentOff: 10, usageLimit: 0 }],
    [{ code: 'PU', percentOff: 10, perUserLimit: 0 }],
  ])('rejects %j with 400', async (body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it('creates a valid coupon', async () => {
    const res = await POST(req({ code: 'save10', percentOff: 10, usageLimit: 5 }));
    expect(res.status).toBe(200);
    expect(h.created[0]).toMatchObject({ code: 'SAVE10', percentOff: 10, usageLimit: 5 });
  });

  it('a code taken by another restaurant gets a generic 409', async () => {
    h.existing = { id: 'other-tenant' };
    const res = await POST(req({ code: 'TAKEN', percentOff: 10 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).not.toMatch(/exists/i);
    expect(body.reason).toBe('code_unavailable');
  });
});

describe('coupon edit bounds', () => {
  it('rejects percentOff > 100 and a patch that removes every discount', async () => {
    expect((await PATCH(req({ percentOff: 101 }), ctx)).status).toBe(400);
    expect((await PATCH(req({ percentOff: null }), ctx)).status).toBe(400);
    expect(h.updated).toHaveLength(0);
  });

  it('renaming onto a taken code is a generic 409', async () => {
    h.existing = { id: 'x' };
    expect((await PATCH(req({ code: 'TAKEN' }), ctx)).status).toBe(409);
  });
});
