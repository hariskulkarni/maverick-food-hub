/**
 * Menu sync: GET /menu normalization, INR-only location check, import (via the
 * spreadsheet importer) + linking, linking/unlinking with tenant scope, name
 * auto-match, and the availability reconcile (newer webhook wins).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  menu: [] as any[],
  topCurrency: undefined as string | undefined,
  importRows: null as any,
  branchItems: [] as any[],
  links: [] as any[],
  upserts: [] as any[],
  deletes: [] as any[],
  itemUpdates: [] as any[],
  linkGuard: 1,
  ownItem: true,
  cfg: null as any,
}));

// The base-URL guard resolves the host on every call; keep unit tests off the network.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));
vi.mock('@/server/db', () => {
  const prisma: any = {
    novaryqLocationLink: {
      findFirst: vi.fn(async () => ({ restaurantId: 'r1', branchId: 'b1', novaryqLocationId: 'loc_1' })),
      findMany: vi.fn(async () => [{ restaurantId: 'r1', branchId: 'b1', novaryqLocationId: 'loc_1' }]),
    },
    menuItem: {
      findFirst: vi.fn(async () => (h.ownItem ? { id: 'm1' } : null)),
      findMany: vi.fn(async () => h.branchItems),
      update: vi.fn(async (a: any) => { h.itemUpdates.push(a); return {}; }),
    },
    novaryqItemLink: {
      upsert: vi.fn(async (a: any) => { h.upserts.push(a); return {}; }),
      deleteMany: vi.fn(async (a: any) => { h.deletes.push(a); return { count: 1 }; }),
      updateMany: vi.fn(async () => ({ count: h.linkGuard })),
      findMany: vi.fn(async () => h.links),
    },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/menu-io', () => ({
  applyMenuImport: vi.fn(async (_b: string, rows: any) => { h.importRows = rows; return { created: rows.length, updated: 0, skipped: 0, categoriesCreated: 1 }; }),
}));
vi.mock('@/server/novaryq/config', async (orig) => ({ ...(await orig<any>()), loadNovaryqConfig: vi.fn(async () => h.cfg) }));

import { testNovaryqConnection, checkLocationCurrency, fetchNovaryqMenu, importNovaryqMenu, linkItem, reconcileRestaurant, suggestMatches } from '@/server/novaryq/menu';

const creds = { baseUrl: 'https://pos.example.com', clientId: 'c', secret: 's' };

beforeEach(() => {
  h.menu = [
    { itemCode: 'SKU-1', name: 'Paneer Tikka', price: '249.00', currency: 'INR', available: true, categoryName: 'Starters' },
    { itemCode: 'SKU-2', name: 'Mango Lassi', price: 99, currency: 'INR', available: false, category: 'Drinks' },
    { itemCode: 'SKU-3', name: 'Open item', price: null, currency: 'INR', available: true, categoryName: 'Misc' },
  ];
  h.topCurrency = undefined;
  h.importRows = null;
  h.branchItems = [];
  h.links = [];
  h.upserts = [];
  h.deletes = [];
  h.itemUpdates = [];
  h.linkGuard = 1;
  h.ownItem = true;
  h.cfg = { ...creds, webhookSecret: 'w', enabled: true, pushOn: 'RECEIVED' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: h.menu, page: 1, pageSize: 100, total: h.menu.length, ...(h.topCurrency ? { currency: h.topCurrency } : {}) }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchNovaryqMenu', () => {
  it('normalizes items (categoryName or category, numeric price, availability)', async () => {
    const { items } = await fetchNovaryqMenu(creds, 'loc_1');
    expect(items[0]).toEqual({ itemCode: 'SKU-1', name: 'Paneer Tikka', price: 249, currency: 'INR', available: true, categoryName: 'Starters' });
    expect(items[1]).toMatchObject({ categoryName: 'Drinks', price: 99, available: false });
    expect((fetch as any).mock.calls[0][0]).toBe('https://pos.example.com/api/v1/menu?locationId=loc_1');
  });
});

describe('testNovaryqConnection — Novaryq India tenants only (ADR-FNI-001 §1.4)', () => {
  it('an INR tenant connects', async () => {
    expect(await testNovaryqConnection(creds)).toMatchObject({ ok: true });
  });
  it('a North America tenant (USD/CAD) is refused with a clear message', async () => {
    h.menu[1].currency = 'CAD';
    const r = await testNovaryqConnection(creds);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Novaryq India/);
    expect(r.error).toMatch(/CAD/);
    h.menu = [];
    h.topCurrency = 'USD';
    expect((await testNovaryqConnection(creds)).ok).toBe(false);
  });
});

describe('checkLocationCurrency (refuse non-INR)', () => {
  it('INR location → ok', async () => {
    expect(await checkLocationCurrency(creds, 'loc_1')).toEqual({ ok: true, currency: 'INR', itemCount: 3 });
  });
  it('a USD location is refused with a clear error', async () => {
    h.menu[0].currency = 'USD';
    const r = await checkLocationCurrency(creds, 'loc_1');
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/USD.*INR only/);
  });
  it('no currency information → refused (cannot confirm INR)', async () => {
    h.menu = h.menu.map(({ currency, ...rest }) => rest);
    expect((await checkLocationCurrency(creds, 'loc_1')).ok).toBe(false);
    h.topCurrency = 'INR';
    expect((await checkLocationCurrency(creds, 'loc_1')).ok).toBe(true);
  });
});

describe('importNovaryqMenu', () => {
  it('imports priced items into the branch and links each to its Novaryq code', async () => {
    h.branchItems = [
      { id: 'm1', name: 'Paneer Tikka', category: { name: 'Starters' } },
      { id: 'm2', name: 'Mango Lassi', category: { name: 'Drinks' } },
    ];
    const r = await importNovaryqMenu('r1', 'b1');
    expect(h.importRows).toEqual([
      { category: 'Starters', name: 'Paneer Tikka', price: 249, isAvailable: true },
      { category: 'Drinks', name: 'Mango Lassi', price: 99, isAvailable: false },
    ]);
    expect(h.upserts.map((u) => [u.where.menuItemId, u.create.novaryqItemCode])).toEqual([['m1', 'SKU-1'], ['m2', 'SKU-2']]);
    expect(r).toMatchObject({ created: 2, linked: 2, skippedUnpriced: 1 });
  });
});

describe('linkItem', () => {
  it('links and unlinks an item of this restaurant', async () => {
    expect(await linkItem('r1', 'm1', ' SKU-1 ')).toEqual({ ok: true });
    expect(h.upserts[0]).toMatchObject({ where: { menuItemId: 'm1' }, create: { restaurantId: 'r1', menuItemId: 'm1', novaryqItemCode: 'SKU-1' } });
    expect(await linkItem('r1', 'm1', null)).toEqual({ ok: true });
    expect(h.deletes[0]).toEqual({ where: { restaurantId: 'r1', menuItemId: 'm1' } });
  });
  it('refuses another restaurant\'s item', async () => {
    h.ownItem = false;
    expect(await linkItem('r1', 'mX', 'SKU-1')).toEqual({ ok: false, error: 'Menu item not found' });
    expect(h.upserts).toHaveLength(0);
  });
});

describe('suggestMatches (auto-match by name)', () => {
  const nq = (code: string, name: string) => ({ itemCode: code, name, price: 1, currency: 'INR', available: true, categoryName: null });
  it('matches unlinked items by normalized name, skipping ambiguous and already-used codes', () => {
    const flavrly = [
      { id: 'a', name: 'Paneer Tikka', linkedCode: null },
      { id: 'b', name: 'Dal  Makhani!', linkedCode: null },
      { id: 'c', name: 'Naan', linkedCode: null },
      { id: 'd', name: 'naan', linkedCode: null },
      { id: 'e', name: 'Lassi', linkedCode: 'SKU-L' },
    ];
    const novaryq = [nq('P1', 'paneer tikka'), nq('D1', 'Dal Makhani'), nq('N1', 'Naan'), nq('X1', 'Raita'), nq('USED', 'Raita Special')];
    expect(suggestMatches(flavrly, novaryq, new Set(['USED']))).toEqual([
      { menuItemId: 'a', itemCode: 'P1' },
      { menuItemId: 'b', itemCode: 'D1' },
    ]);
  });
});

describe('reconcileRestaurant', () => {
  it('aligns linked items with POS availability; a newer webhook (guard miss) wins; missing codes are counted', async () => {
    h.links = [
      { id: 'l1', menuItemId: 'm1', novaryqItemCode: 'SKU-1', menuItem: { isAvailable: false } },
      { id: 'l2', menuItemId: 'm2', novaryqItemCode: 'SKU-2', menuItem: { isAvailable: true } },
      { id: 'l9', menuItemId: 'm9', novaryqItemCode: 'GONE', menuItem: { isAvailable: true } },
    ];
    const r = await reconcileRestaurant('r1');
    expect(r).toEqual({ checked: 3, changed: 2, missing: 1 });
    expect(h.itemUpdates.map((u) => [u.where.id, u.data.isAvailable])).toEqual([['m1', true], ['m2', false]]);
    h.itemUpdates = [];
    h.linkGuard = 0;
    expect((await reconcileRestaurant('r1')).changed).toBe(0);
  });
  it('does nothing for a disabled restaurant', async () => {
    h.cfg = { ...h.cfg, enabled: false };
    expect(await reconcileRestaurant('r1')).toEqual({ checked: 0, changed: 0, missing: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
