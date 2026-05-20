/**
 * Unit tests for the menu import engine.
 *   - slugify: url-safe, bounded, fallback
 *   - parseMenuFile: CSV header-aliasing, type coercion, blank-row skip, and the
 *     "must have Category + Item Name" guard
 *   - diffMenuImport: create/update/error classification (prisma mocked)
 *
 * parseMenuFile + slugify are pure (exceljs only, no DB). diffMenuImport touches
 * prisma.menuItem.findMany, so we mock the prisma singleton like freebies.test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('@/server/db', () => ({
  prisma: {
    menuItem: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}));

import { slugify, parseMenuFile, diffMenuImport } from '@/server/menu-io';

beforeEach(() => {
  findMany.mockReset();
});

describe('slugify', () => {
  it('lowercases + hyphenates + strips punctuation', () => {
    expect(slugify('Paneer Tikka Masala!')).toBe('paneer-tikka-masala');
  });
  it('trims leading/trailing separators', () => {
    expect(slugify('  --Gulab Jamun--  ')).toBe('gulab-jamun');
  });
  it('falls back to "item" for empty/garbage input', () => {
    expect(slugify('!!!')).toBe('item');
    expect(slugify('')).toBe('item');
  });
});

function csv(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

describe('parseMenuFile (CSV)', () => {
  it('maps aliased headers + coerces types', async () => {
    const rows = await parseMenuFile(
      csv(
        [
          'Category,Item Name,Description,Price,Veg,Spicy Level,Prep Time (min),Available',
          'Starters,Paneer Tikka,Smoky cubes,₹249,Veg,2,15,Yes',
          'Mains,Chicken Curry,,320,Non-Veg,3,25,No',
        ].join('\n')
      ),
      'menu.csv'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      category: 'Starters',
      name: 'Paneer Tikka',
      description: 'Smoky cubes',
      price: 249, // ₹ + comma stripped
      isVeg: true,
      spicyLevel: 2,
      prepTimeMin: 15,
      isAvailable: true,
    });
    expect(rows[1]).toMatchObject({ isVeg: false, isAvailable: false, price: 320 });
    expect(rows[1].description).toBeUndefined();
  });

  it('accepts snake_case / abbreviated headers', async () => {
    const rows = await parseMenuFile(
      csv(['item_name,category,baseprice', 'Lassi,Drinks,80'].join('\n')),
      'x.csv'
    );
    expect(rows[0]).toMatchObject({ category: 'Drinks', name: 'Lassi', price: 80 });
  });

  it('skips fully blank rows', async () => {
    const rows = await parseMenuFile(
      csv(['Category,Item Name,Price', 'Drinks,Soda,40', ',,', 'Drinks,Water,20'].join('\n')),
      'x.csv'
    );
    expect(rows).toHaveLength(2);
  });

  it('throws when Category/Item columns are absent', async () => {
    await expect(
      parseMenuFile(csv(['Foo,Bar', '1,2'].join('\n')), 'x.csv')
    ).rejects.toThrow(/Category.*Item Name/i);
  });
});

describe('diffMenuImport', () => {
  it('classifies create vs update vs error', async () => {
    // Existing menu has "Starters / Paneer Tikka" already.
    findMany.mockResolvedValue([
      { name: 'Paneer Tikka', category: { name: 'Starters' } },
    ]);
    const diff = await diffMenuImport('branch-1', [
      { category: 'Starters', name: 'Paneer Tikka', price: 260 }, // update (exists, case-insensitive)
      { category: 'Mains', name: 'Dal Fry', price: 180 },          // create
      { category: 'Mains', name: 'No Price' },                     // error: missing price
      { category: '', name: 'Orphan', price: 10 },                 // error: missing category
      { category: 'Mains', name: 'Too Spicy', price: 90, spicyLevel: 9 }, // error: spice 0-3
    ]);
    expect(diff.map((d) => d.action)).toEqual(['update', 'create', 'error', 'error', 'error']);
    expect(diff[2].errors).toContain('Missing or invalid price');
    expect(diff[3].errors).toContain('Missing category');
    expect(diff[0].index).toBe(1); // 1-based
  });

  it('flags negative prices as errors', async () => {
    findMany.mockResolvedValue([]);
    const diff = await diffMenuImport('b', [{ category: 'X', name: 'Y', price: -5 }]);
    expect(diff[0].action).toBe('error');
    expect(diff[0].errors).toContain('Price cannot be negative');
  });
});
