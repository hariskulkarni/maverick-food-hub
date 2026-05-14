/**
 * Pure-aggregator tests for the brand reporting helpers. We deliberately
 * cover the math here — `getBrandSalesRollup`'s DB layer is exercised by the
 * e2e seed, but the fold logic is what determines whether the dashboards are
 * trustworthy.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  sumByRestaurant, sumByBranch, sumByItem, slugifyName,
  type OrderRowForSum, type OrderItemRowForSum
} from '@/server/brands';

const orders: OrderRowForSum[] = [
  { id: 'o1', branchId: 'b-pizza-koramangala', restaurantId: 'r-italia',    total: 450 },
  { id: 'o2', branchId: 'b-pizza-koramangala', restaurantId: 'r-italia',    total: 800 },
  { id: 'o3', branchId: 'b-biryani-indira',    restaurantId: 'r-biryani',   total: 600 },
  { id: 'o4', branchId: 'b-bbq-hsr',           restaurantId: 'r-bbq',       total: 1200 },
  { id: 'o5', branchId: 'b-bbq-hsr',           restaurantId: 'r-bbq',       total: 900 }
];

describe('sumByRestaurant', () => {
  it('rolls revenue + orders per cuisine', () => {
    const m = sumByRestaurant(orders);
    expect(m.get('r-italia')).toEqual({ revenue: 1250, orders: 2 });
    expect(m.get('r-biryani')).toEqual({ revenue: 600,  orders: 1 });
    expect(m.get('r-bbq')).toEqual({     revenue: 2100, orders: 2 });
  });

  it('returns empty for empty input', () => {
    expect(sumByRestaurant([]).size).toBe(0);
  });

  it('rounds to 2dp', () => {
    const m = sumByRestaurant([
      { id: 'o', branchId: 'b', restaurantId: 'r', total: 100.005 },
      { id: 'o2', branchId: 'b', restaurantId: 'r', total: 100.004 }
    ]);
    expect(m.get('r')!.revenue).toBe(200.01);
  });
});

describe('sumByBranch', () => {
  it('rolls revenue + orders per branch (potentially across many restaurants)', () => {
    const m = sumByBranch(orders);
    expect(m.get('b-pizza-koramangala')).toEqual({ revenue: 1250, orders: 2 });
    expect(m.get('b-bbq-hsr')).toEqual({           revenue: 2100, orders: 2 });
    expect(m.get('b-biryani-indira')).toEqual({    revenue: 600,  orders: 1 });
  });

  it('handles a shared kitchen that serves orders from multiple cuisines', () => {
    // Same branchId can appear under different restaurantIds in a shared-kitchen scenario.
    const shared: OrderRowForSum[] = [
      { id: 'a', branchId: 'b-shared', restaurantId: 'r-pizza',   total: 300 },
      { id: 'b', branchId: 'b-shared', restaurantId: 'r-biryani', total: 500 }
    ];
    const m = sumByBranch(shared);
    expect(m.get('b-shared')).toEqual({ revenue: 800, orders: 2 });
  });
});

describe('sumByItem', () => {
  it('rolls per-item revenue using qty × unitPrice and counts unique orders per item', () => {
    const items: OrderItemRowForSum[] = [
      { orderId: 'o1', menuItemId: 'mi-margherita', comboId: null, name: 'Margherita', quantity: 1, unitPrice: 250 },
      { orderId: 'o1', menuItemId: 'mi-pepsi',      comboId: null, name: 'Pepsi',      quantity: 2, unitPrice: 50 },
      { orderId: 'o2', menuItemId: 'mi-margherita', comboId: null, name: 'Margherita', quantity: 3, unitPrice: 250 },
      { orderId: 'o3', menuItemId: null, comboId: 'cb-family-bbq', name: 'Family BBQ', quantity: 1, unitPrice: 1200 }
    ];
    const m = sumByItem(items);
    expect(m.get('mi-margherita')).toEqual({ label: 'Margherita', revenue: 1000, orders: 2 });
    expect(m.get('mi-pepsi')).toEqual({      label: 'Pepsi',      revenue: 100,  orders: 1 });
    expect(m.get('cb-family-bbq')).toEqual({ label: 'Family BBQ', revenue: 1200, orders: 1 });
  });

  it('does not double-count orders when an item appears twice in the same order', () => {
    // Two lines for the same menuItemId in one order should yield orders: 1, not 2.
    const items: OrderItemRowForSum[] = [
      { orderId: 'o1', menuItemId: 'mi-a', comboId: null, name: 'A', quantity: 1, unitPrice: 100 },
      { orderId: 'o1', menuItemId: 'mi-a', comboId: null, name: 'A', quantity: 2, unitPrice: 100 }
    ];
    const m = sumByItem(items);
    expect(m.get('mi-a')).toEqual({ label: 'A', revenue: 300, orders: 1 });
  });

  it('falls back to name-keyed grouping when both ids are null (legacy snapshot rows)', () => {
    const items: OrderItemRowForSum[] = [
      { orderId: 'o1', menuItemId: null, comboId: null, name: 'Mystery Special', quantity: 1, unitPrice: 200 },
      { orderId: 'o2', menuItemId: null, comboId: null, name: 'Mystery Special', quantity: 1, unitPrice: 200 }
    ];
    const m = sumByItem(items);
    expect(m.get('name:Mystery Special')).toEqual({ label: 'Mystery Special', revenue: 400, orders: 2 });
  });
});

describe('slugifyName', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(slugifyName('Maverick Hospitality')).toBe('maverick-hospitality');
    expect(slugifyName('Bowl & Barbeque')).toBe('bowl-barbeque');
    expect(slugifyName('Italia Pizza!!!')).toBe('italia-pizza');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugifyName('  Wok and Sizzler  ')).toBe('wok-and-sizzler');
    expect(slugifyName('!Hotel Siddhartha!')).toBe('hotel-siddhartha');
  });

  it('caps at 64 characters', () => {
    const long = 'a'.repeat(120);
    expect(slugifyName(long).length).toBe(64);
  });

  it('produces empty string for content-free input', () => {
    expect(slugifyName('!!!')).toBe('');
    expect(slugifyName('')).toBe('');
  });
});
