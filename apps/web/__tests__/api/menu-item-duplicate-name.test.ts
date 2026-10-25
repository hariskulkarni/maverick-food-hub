/**
 * UI smoke defect — creating a dish whose name (slug) already exists in the
 * branch hit the @@unique([branchId, slug]) constraint and returned a bare 500
 * ("Could not create item" with no reason). It must be a 409 with a clear
 * message instead.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/api-auth', () => ({ requireRestaurantAdminApi: async () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));
vi.mock('@/app/api/admin/menu/_tenant', () => ({
  callerRestaurantId: async () => 'A',
  branchOwned: async () => true,
  categoryInBranch: async () => true,
  notFound: (what: string) => Response.json({ error: `${what} not found` }, { status: 404 }),
}));
vi.mock('@/server/db', () => ({
  prisma: {
    menuItem: {
      create: async () => {
        const e: any = new Error('Unique constraint failed on the fields: (`branchId`,`slug`)');
        e.code = 'P2002';
        throw e;
      },
    },
  },
}));

import { POST } from '@/app/api/admin/menu/items/route';

const req = (body: unknown) => ({ json: async () => body, nextUrl: new URL('http://x/api/admin/menu/items') }) as any;
const body = { branchId: 'b1', categoryId: 'c1', name: 'Paneer Tikka', slug: 'paneer-tikka', price: 240, isVeg: true };

describe('POST /api/admin/menu/items duplicate name', () => {
  it('returns 409 with a readable error instead of a 500', async () => {
    const r = await POST(req(body));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toMatch(/already/i);
  });
});
