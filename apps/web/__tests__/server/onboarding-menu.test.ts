/**
 * Cuisine templates, template → import rows, and the example CSV (which must
 * round-trip through the real import parser + validator with zero row errors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('@/server/db', () => ({ prisma: { menuItem: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { MENU_TEMPLATES, templateToMenuRows, TemplateError, buildExampleCsv, CSV_HEADERS } from '@/lib/onboarding/menu-templates';
import { parseMenuFile, diffMenuImport } from '@/server/menu-io';

beforeEach(() => findMany.mockReset().mockResolvedValue([]));

describe('menu templates', () => {
  it('ships the five cuisines with 8–15 realistic, uniquely named items each', () => {
    expect(MENU_TEMPLATES.map((t) => t.id)).toEqual(['north-indian', 'south-indian', 'chinese', 'cafe-bakery', 'pizza']);
    for (const t of MENU_TEMPLATES) {
      expect(t.items.length).toBeGreaterThanOrEqual(8);
      expect(t.items.length).toBeLessThanOrEqual(15);
      expect(new Set(t.items.map((x) => x.name.toLowerCase())).size).toBe(t.items.length);
      for (const it of t.items) {
        expect(it.price).toBeGreaterThanOrEqual(30);
        expect(it.price).toBeLessThanOrEqual(500);
        expect(it.description.length).toBeGreaterThan(5);
      }
    }
  });

  it('templateToMenuRows applies edits, exclusions and validates', () => {
    const rows = templateToMenuRows('pizza', [
      { index: 0, include: true, price: 279, name: 'Classic Margherita' },
      { index: 1, include: false },
    ]);
    const tpl = MENU_TEMPLATES.find((t) => t.id === 'pizza')!;
    expect(rows).toHaveLength(tpl.items.length - 1);
    expect(rows[0]).toMatchObject({ name: 'Classic Margherita', price: 279, isAvailable: true, category: 'Pizzas (Medium)' });
    expect(rows.find((r) => r.name === 'Farmhouse')).toBeUndefined();
  });

  it('templateToMenuRows rejects bad input', () => {
    expect(() => templateToMenuRows('thai')).toThrow(TemplateError);
    expect(() => templateToMenuRows('pizza', [{ index: 99, include: true }])).toThrow(/does not exist/);
    expect(() => templateToMenuRows('pizza', [{ index: 0, include: true, price: 0 }])).toThrow(/price/);
    expect(() => templateToMenuRows('pizza', [{ index: 0, include: true, name: '  ' }])).toThrow(/blank/);
    const all = MENU_TEMPLATES[0]!.items.map((_, index) => ({ index, include: false }));
    expect(() => templateToMenuRows('north-indian', all)).toThrow(/at least one/);
  });
});

describe('example CSV', () => {
  it('has the import headers and parses with zero row errors', async () => {
    const csv = buildExampleCsv();
    expect(csv.split('\n')[0]).toBe(CSV_HEADERS.join(','));
    const rows = await parseMenuFile(Buffer.from(csv, 'utf8'), 'example.csv');
    expect(rows.length).toBe(6);
    expect(rows[0]).toMatchObject({ category: 'Starters', name: 'Paneer Tikka', price: 260, isVeg: true });
    expect(rows.some((r) => r.isVeg === false)).toBe(true);
    expect(rows[rows.length - 1]!.isAvailable).toBe(false);
    const diff = await diffMenuImport('b1', rows);
    expect(diff.every((d) => d.action === 'create')).toBe(true);
  });

  it('row-level errors are reported per row for a broken file', async () => {
    const bad = [CSV_HEADERS.join(','), 'Starters,,Missing name,100,Veg,0,10,Yes', ',Orphan,No category,abc,Veg,5,10,Yes'].join('\n');
    const rows = await parseMenuFile(Buffer.from(bad), 'bad.csv');
    const diff = await diffMenuImport('b1', rows);
    expect(diff[0]).toMatchObject({ index: 1, action: 'error', errors: ['Missing item name'] });
    expect(diff[1]!.errors).toEqual(expect.arrayContaining(['Missing category', 'Missing or invalid price', 'Spicy level must be 0–3']));
  });
});
