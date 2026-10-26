/**
 * Every /api/admin/integrations/novaryq/* route: restaurant ADMIN membership of the
 * active restaurant only. KITCHEN members, SUPER_ADMIN (even with ?restaurantId=),
 * customers and signed-out callers are refused BEFORE any tenant data is read
 * (the db stub throws on anything but the membership lookups). An ADMIN of
 * restaurant A cannot read or write restaurant B's branches, items or syncs.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as any,
  role: 'ADMIN' as 'ADMIN' | 'KITCHEN',
  open: false, // when true the stub answers tenant reads (cross-tenant cases)
  writes: [] as string[],
}));

vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/db', () => {
  const branches: Record<string, string> = { bA: 'A', bB: 'B' };
  const items: Record<string, string> = { iA: 'bA', iB: 'bB' };
  const syncs: Record<string, string> = { sA: 'A', sB: 'B' };
  const allowed: Record<string, any> = {
    restaurantUser: {
      findMany: async () => [{ restaurantId: 'A', role: h.role, restaurant: { id: 'A', name: 'A', parentId: null } }],
    },
    restaurant: { findMany: async () => [] },
  };
  const tenant: Record<string, any> = {
    branch: { findFirst: async ({ where }: any) => (branches[where.id] === where.restaurantId ? { id: where.id } : null) },
    menuItem: { findFirst: async ({ where }: any) => (branches[items[where.id]] === where.branch.restaurantId ? { id: where.id } : null) },
    novaryqOrderSync: {
      findFirst: async ({ where }: any) => (syncs[where.id] === where.restaurantId ? { id: where.id, state: 'DEAD', orderId: 'o', order: { status: 'RECEIVED' } } : null),
      updateMany: async () => { h.writes.push('sync'); return { count: 1 }; },
    },
    novaryqItemLink: {
      upsert: async () => { h.writes.push('link'); return {}; },
      deleteMany: async () => { h.writes.push('unlink'); return { count: 1 }; },
    },
    novaryqLocationLink: { deleteMany: async () => { h.writes.push('location'); return { count: 0 }; } },
  };
  const prisma = new Proxy({}, {
    get(_t, model: string) {
      if (allowed[model]) return allowed[model];
      if (h.open && tenant[model]) return tenant[model];
      return new Proxy({}, { get(_x, op: string) { return () => { throw new Error(`unexpected db access ${model}.${op}`); }; } });
    },
  });
  return { prisma, db: prisma };
});

const req = (method: string, body?: unknown, url = 'http://x/api/admin/integrations/novaryq') => {
  const u = new URL(url);
  return Object.assign(new Request(u, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }), { nextUrl: u }) as any;
};
const ctx = (params: Record<string, string>): any => ({ params: Promise.resolve(params) });
const base = '@/app/api/admin/integrations/novaryq';

const ROUTES: [string, () => Promise<Response>][] = [
  ['GET overview', async () => (await import(`${base}/route`)).GET()],
  ['PUT credentials', async () => (await import(`${base}/route`)).PUT(req('PUT', { baseUrl: 'https://p', clientId: 'c', secret: 's', enabled: true }))],
  ['DELETE credentials', async () => (await import(`${base}/route`)).DELETE()],
  ['POST test', async () => (await import(`${base}/test/route`)).POST()],
  ['PUT locations', async () => (await import(`${base}/locations/route`)).PUT(req('PUT', { branchId: 'bA', novaryqLocationId: 'loc_1' }))],
  ['DELETE locations', async () => (await import(`${base}/locations/route`)).DELETE(req('DELETE', undefined, 'http://x/api/admin/integrations/novaryq/locations?branchId=bA'))],
  ['GET items', async () => (await import(`${base}/items/route`)).GET(req('GET', undefined, 'http://x/api/admin/integrations/novaryq/items?branchId=bA'))],
  ['PUT items', async () => (await import(`${base}/items/route`)).PUT(req('PUT', { menuItemId: 'iA', itemCode: 'SKU' }))],
  ['POST auto-match', async () => (await import(`${base}/items/auto-match/route`)).POST(req('POST', { branchId: 'bA' }))],
  ['POST import', async () => (await import(`${base}/import/route`)).POST(req('POST', { branchId: 'bA' }))],
  ['GET syncs', async () => (await import(`${base}/syncs/route`)).GET(req('GET', undefined, 'http://x/api/admin/integrations/novaryq/syncs'))],
  ['POST replay', async () => (await import(`${base}/syncs/[id]/replay/route`)).POST(req('POST'), ctx({ id: 'sA' }))],
];

// Load every route module once up front so a cold import never eats a test's 5 s budget.
beforeAll(async () => {
  for (const m of ['route', 'test/route', 'locations/route', 'items/route', 'items/auto-match/route', 'import/route', 'syncs/route', 'syncs/[id]/replay/route']) {
    await import(`${base}/${m}`);
  }
}, 120_000);

beforeEach(() => {
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.session = { user: { id: 'u1', role: 'ADMIN' } };
  h.role = 'ADMIN';
  h.open = false;
  h.writes = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('Novaryq admin routes refuse non-admins before touching tenant data', () => {
  it.each(ROUTES)('%s: KITCHEN member → 403', async (_n, call) => {
    h.role = 'KITCHEN';
    expect((await call()).status).toBe(403);
  });
  it.each(ROUTES)('%s: SUPER_ADMIN (no membership) → 403', async (_n, call) => {
    h.session = { user: { id: 'sa', role: 'SUPER_ADMIN' } };
    expect((await call()).status).toBe(403);
  });
  it.each(ROUTES)('%s: CUSTOMER → 403', async (_n, call) => {
    h.session = { user: { id: 'c', role: 'CUSTOMER' } };
    expect((await call()).status).toBe(403);
  });
  it.each(ROUTES)('%s: signed out → 401', async (_n, call) => {
    h.session = null;
    expect((await call()).status).toBe(401);
  });
});

describe('SUPER_ADMIN cannot target a tenant with ?restaurantId=', () => {
  it('GET overview?restaurantId=A → 403', async () => {
    h.session = { user: { id: 'sa', role: 'SUPER_ADMIN' } };
    const { GET } = await import(`${base}/syncs/route`);
    expect((await GET(req('GET', undefined, 'http://x/api/admin/integrations/novaryq/syncs?restaurantId=A'))).status).toBe(403);
  });
});

describe('ADMIN of restaurant A cannot reach restaurant B', () => {
  beforeEach(() => { h.open = true; });
  it('items/import/auto-match on B\'s branch → 404', async () => {
    expect((await (await import(`${base}/items/route`)).GET(req('GET', undefined, 'http://x/api/admin/integrations/novaryq/items?branchId=bB'))).status).toBe(404);
    expect((await (await import(`${base}/import/route`)).POST(req('POST', { branchId: 'bB' }))).status).toBe(404);
    expect((await (await import(`${base}/items/auto-match/route`)).POST(req('POST', { branchId: 'bB' }))).status).toBe(404);
  });
  it('linking B\'s menu item → 404, nothing written', async () => {
    const { PUT } = await import(`${base}/items/route`);
    expect((await PUT(req('PUT', { menuItemId: 'iB', itemCode: 'SKU' }))).status).toBe(404);
    expect(h.writes).toEqual([]);
  });
  it('replaying B\'s sync → 404, nothing written', async () => {
    const { POST } = await import(`${base}/syncs/[id]/replay/route`);
    expect((await POST(req('POST'), ctx({ id: 'sB' }))).status).toBe(404);
    expect(h.writes).toEqual([]);
  });
  it('removing B\'s branch location deletes nothing (scoped to A)', async () => {
    const { DELETE } = await import(`${base}/locations/route`);
    const r = await DELETE(req('DELETE', undefined, 'http://x/api/admin/integrations/novaryq/locations?branchId=bB'));
    expect(await r.json()).toMatchObject({ removed: 0 });
  });
  it('own item links; own DEAD sync replays', async () => {
    expect((await (await import(`${base}/items/route`)).PUT(req('PUT', { menuItemId: 'iA', itemCode: 'SKU' }))).status).toBe(200);
    expect((await (await import(`${base}/syncs/[id]/replay/route`)).POST(req('POST'), ctx({ id: 'sA' }))).status).toBe(200);
    expect(h.writes).toEqual(['link', 'sync']);
  });
});

describe('platform flag off', () => {
  it('writes → 403 for an ADMIN', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    const { PUT } = await import(`${base}/items/route`);
    expect((await PUT(req('PUT', { menuItemId: 'iA', itemCode: 'SKU' }))).status).toBe(403);
  });
});
