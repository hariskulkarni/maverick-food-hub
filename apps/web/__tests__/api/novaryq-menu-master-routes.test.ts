/**
 * "POS: Novaryq" is enforced on the admin menu write routes: the single-item PATCH and the
 * bulk toggle ask novaryqItemLock before writing; spreadsheet import and the onboarding
 * template ask novaryqBulkImportLock. A lock answer (409) is returned and nothing is written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ lock: null as Response | null, bulkLock: null as Response | null, writes: [] as string[], lockArgs: [] as any[] }));

vi.mock('@/server/novaryq/menu-master', () => ({
  novaryqItemLock: vi.fn(async (...a: any[]) => { h.lockArgs.push(a); return h.lock; }),
  novaryqBulkImportLock: vi.fn(async () => h.bulkLock),
}));
vi.mock('@/server/api-auth', () => ({ requireRestaurantAdminApi: async () => ({ user: { id: 'u1', role: 'ADMIN', name: 'A' } }) }));
vi.mock('@/server/tenancy', () => ({ requireRestaurant: async () => ({ id: 'A', name: 'A' }) }));
vi.mock('@/server/alerts', () => ({ sendMenuToggleAlert: async () => {} }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/app/api/admin/menu/import/_helpers', () => ({ resolveBranchScope: async () => ({ branchId: 'bA', restaurantId: 'A', restaurantName: 'A' }) }));
vi.mock('@/server/menu-io', () => ({ applyMenuImport: vi.fn(async () => { h.writes.push('import'); return { created: 1, updated: 0, skipped: 0, categoriesCreated: 0 }; }) }));
vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));
vi.mock('@/server/db', () => {
  const item = { id: 'iA', name: 'Paneer Tikka', isAvailable: true, branch: { id: 'bA', name: 'B', restaurantId: 'A', restaurant: { id: 'A', name: 'A' } } };
  const prisma: any = {
    menuItem: {
      findFirst: async () => item,
      findMany: async () => [{ id: 'iA', isAvailable: true, branch: { id: 'bA', name: 'B' } }],
      count: async ({ where }: any) => where.id.in.length,
      update: async () => { h.writes.push('update'); return item; },
      updateMany: async () => { h.writes.push('updateMany'); return { count: 1 }; },
    },
    auditLog: { create: async () => ({}) },
  };
  return { prisma, db: prisma };
});

const req = (body: unknown) => Object.assign(new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { nextUrl: new URL('http://x') }) as any;
const locked = () => Response.json({ error: 'Managed in Novaryq', code: 'novaryq/managed' }, { status: 409 });

beforeEach(() => {
  h.lock = null;
  h.bulkLock = null;
  h.writes = [];
  h.lockArgs = [];
});

describe('menu write routes honour "POS: Novaryq"', () => {
  it('PATCH item: 409 from the lock, nothing written; the patch is passed to the lock', async () => {
    const { PATCH } = await import('@/app/api/admin/menu/items/[id]/route');
    h.lock = locked();
    const r = await PATCH(req({ price: 260 }), { params: Promise.resolve({ id: 'iA' }) });
    expect(r.status).toBe(409);
    expect(h.writes).toEqual([]);
    expect(h.lockArgs[0]).toEqual(['A', ['iA'], { name: undefined, price: 260, isAvailable: undefined }]);
  });

  it('PATCH item: no lock → saved as before', async () => {
    const { PATCH } = await import('@/app/api/admin/menu/items/[id]/route');
    const r = await PATCH(req({ description: 'Smoky' }), { params: Promise.resolve({ id: 'iA' }) });
    expect(r.status).toBe(200);
    expect(h.writes).toEqual(['update']);
  });

  it('bulk availability: 409 from the lock, nothing written', async () => {
    const { POST } = await import('@/app/api/admin/menu/items/bulk/route');
    h.lock = locked();
    const r = await POST(req({ ids: ['iA'], patch: { isAvailable: false } }));
    expect(r.status).toBe(409);
    expect(h.writes).toEqual([]);
    expect(h.lockArgs[0]).toEqual(['A', ['iA'], { isAvailable: false }]);
  });

  it('spreadsheet import apply and onboarding template: 409 while Novaryq is the menu master', async () => {
    h.bulkLock = locked();
    const { POST: apply } = await import('@/app/api/admin/menu/import/apply/route');
    expect((await apply(req({ rows: [{ category: 'C', name: 'N', price: 1 }] }))).status).toBe(409);
    h.bulkLock = locked();
    const { POST: template } = await import('@/app/api/admin/onboarding/menu-template/route');
    expect((await template(req({ templateId: 'north-indian' }))).status).toBe(409);
    expect(h.writes).toEqual([]);
  });
});
