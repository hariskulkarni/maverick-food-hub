/**
 * Defect 13 — admin menu writes must not accept another restaurant's ids.
 * Restaurant A's admin tries to create/move items and categories into
 * restaurant B's branch/category; every attempt must 404 without writing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const branches: Record<string, string> = { bA: 'A', bB: 'B' }; // branchId -> restaurantId
const categories: Record<string, string> = { cA: 'bA', cB: 'bB' }; // categoryId -> branchId
const items: Record<string, string> = { iA: 'bA', iB: 'bB' }; // itemId -> branchId
const writes: string[] = [];

vi.mock('@/server/api-auth', () => ({ requireRestaurantAdminApi: async () => ({ user: { id: 'u1', role: 'ADMIN', name: 'A admin' } }) }));
vi.mock('@/server/tenancy', () => ({ requireRestaurant: async () => ({ id: 'A' }) }));
vi.mock('@/server/alerts', () => ({ sendMenuToggleAlert: async () => {} }));
vi.mock('@/server/db', () => ({
  prisma: {
    branch: {
      findFirst: async ({ where }: any) => (branches[where.id] === where.restaurantId ? { id: where.id } : null)
    },
    category: {
      findFirst: async ({ where }: any) => (categories[where.id] === where.branchId ? { id: where.id } : null),
      create: async ({ data }: any) => { writes.push(`category:${data.branchId}`); return { id: 'new', ...data }; }
    },
    menuItem: {
      findFirst: async ({ where }: any) => {
        const b = items[where.id];
        if (!b || branches[b] !== where.branch.restaurantId) return null;
        return { id: where.id, name: 'X', isAvailable: true, branch: { id: b, name: 'B', restaurantId: branches[b], restaurant: { id: branches[b], name: 'R' } } };
      },
      create: async ({ data }: any) => { writes.push(`item:${data.branchId}`); return { id: 'new', ...data }; },
      update: async ({ where, data }: any) => { writes.push(`update:${where.id}`); return { id: where.id, ...data }; }
    }
  }
}));

import { POST as createItem } from '@/app/api/admin/menu/items/route';
import { POST as createCategory } from '@/app/api/admin/menu/categories/route';
import { PATCH as patchItem } from '@/app/api/admin/menu/items/[id]/route';

const req = (body: unknown) => ({ json: async () => body }) as any;
const itemBody = (branchId: string, categoryId: string) => ({ branchId, categoryId, name: 'Dosa', slug: 'dosa', price: 100, isVeg: true });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { writes.length = 0; });

describe('admin menu tenancy', () => {
  it('creates an item in the caller own branch/category', async () => {
    const r = await createItem(req(itemBody('bA', 'cA')));
    expect(r.status).toBe(200);
    expect(writes).toEqual(['item:bA']);
  });
  it('refuses an item in another restaurant branch', async () => {
    const r = await createItem(req(itemBody('bB', 'cB')));
    expect(r.status).toBe(404);
    expect(writes).toEqual([]);
  });
  it('refuses an own-branch item pointing at a foreign category', async () => {
    const r = await createItem(req(itemBody('bA', 'cB')));
    expect(r.status).toBe(404);
    expect(writes).toEqual([]);
  });
  it('refuses a category in another restaurant branch, allows own', async () => {
    expect((await createCategory(req({ branchId: 'bB', name: 'Mains', slug: 'mains' }))).status).toBe(404);
    expect(writes).toEqual([]);
    expect((await createCategory(req({ branchId: 'bA', name: 'Mains', slug: 'mains' }))).status).toBe(200);
  });
  it('refuses PATCH of another restaurant item', async () => {
    const r = await patchItem(req({ price: 1 }), ctx('iB'));
    expect(r.status).toBe(404);
    expect(writes).toEqual([]);
  });
  it('refuses moving an own item into a foreign branch or category', async () => {
    expect((await patchItem(req({ branchId: 'bB' }), ctx('iA'))).status).toBe(404);
    expect((await patchItem(req({ categoryId: 'cB' }), ctx('iA'))).status).toBe(404);
    expect(writes).toEqual([]);
    expect((await patchItem(req({ price: 120 }), ctx('iA'))).status).toBe(200);
    expect(writes).toEqual(['update:iA']);
  });
});
