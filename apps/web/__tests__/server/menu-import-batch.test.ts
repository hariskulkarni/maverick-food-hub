/** P2-16: menu import apply is batched — no per-row lookups, chunked inserts. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  existing: [] as any[],
  calls: { findFirst: 0, create: 0, createMany: [] as number[], update: [] as any[], categoryCreate: 0 },
  txOpts: null as any,
}));

vi.mock('@/server/db', () => {
  const tx = {
    category: {
      findMany: async () => [{ id: 'cat1', name: 'Mains', slug: 'mains', sortOrder: 1 }],
      create: async ({ data }: any) => { h.calls.categoryCreate++; return { id: `cat-${data.slug}`, ...data }; },
    },
    menuItem: {
      findMany: async () => h.existing,
      findFirst: async () => { h.calls.findFirst++; return null; },
      create: async () => { h.calls.create++; return {}; },
      createMany: async ({ data }: any) => { h.calls.createMany.push(data.length); return { count: data.length }; },
      update: async (args: any) => { h.calls.update.push(args); return {}; },
    },
  };
  return {
    prisma: {
      menuItem: { findMany: async () => h.existing.map((i) => ({ name: i.name, category: { name: 'Mains' } })) },
      $transaction: async (fn: any, opts: any) => { h.txOpts = opts; return fn(tx); },
    },
  };
});

import { applyMenuImport } from '@/server/menu-io';

const row = (name: string, price = 100, category = 'Mains') => ({ category, name, price, isVeg: true });

beforeEach(() => {
  h.existing = [];
  h.calls = { findFirst: 0, create: 0, createMany: [], update: [], categoryCreate: 0 };
});

describe('applyMenuImport (batched)', () => {
  it('inserts 1200 new rows with chunked createMany and no per-row queries', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(`Dish ${i}`));
    const res = await applyMenuImport('b1', rows as any);
    expect(res).toEqual({ created: 1200, updated: 0, skipped: 0, categoriesCreated: 0 });
    expect(h.calls.findFirst).toBe(0);
    expect(h.calls.create).toBe(0);
    expect(h.calls.createMany).toEqual([500, 500, 200]);
    expect(h.txOpts.timeout).toBeGreaterThan(30_000);
  });

  it('updates only changed existing items (case-insensitive match) and keeps duplicate rows last-wins', async () => {
    h.existing = [
      { id: 'i1', slug: 'paneer', categoryId: 'cat1', name: 'Paneer', description: null, price: 200, isVeg: true, spicyLevel: 0, prepTimeMin: 20, isAvailable: true },
      { id: 'i2', slug: 'dal', categoryId: 'cat1', name: 'Dal', description: null, price: 150, isVeg: true, spicyLevel: 0, prepTimeMin: 20, isAvailable: true },
    ];
    const res = await applyMenuImport('b1', [row('Paneer', 200), row('DAL', 175), row('Naan', 40), row('Naan', 45)] as any);
    expect(res).toEqual({ created: 1, updated: 3, skipped: 0, categoriesCreated: 0 });
    expect(h.calls.update.map((u) => u.where.id)).toEqual(['i2']);
    expect(h.calls.createMany).toEqual([1]);
  });

  it('creates new categories once and skips error rows', async () => {
    const res = await applyMenuImport('b1', [row('Lassi', 60, 'Drinks'), row('Chaas', 40, 'Drinks'), { category: 'Drinks', name: '', price: 10 }] as any);
    expect(res).toMatchObject({ created: 2, skipped: 1, categoriesCreated: 1 });
    expect(h.calls.categoryCreate).toBe(1);
  });
});
