/**
 * Super-admin wizard: the optional FSSAI number and default opening hours are
 * validated and written onto the first branch (so the owner's readiness check
 * starts with them filled in).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ branchData: null as any, session: { user: { id: 's', role: 'SUPER_ADMIN' } } as any }));

vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/revalidate', () => ({ revalidateRestaurantSurfaces: () => {} }));
vi.mock('@/server/qr', () => ({ ensureRestaurantQr: async () => ({ created: true }) }));
vi.mock('argon2', () => ({ default: { hash: async () => 'hash' } }));
vi.mock('@/server/db', () => {
  const tx = {
    user: { create: async ({ data }: any) => ({ id: 'u-' + data.role, ...data }) },
    restaurant: { create: async ({ data }: any) => ({ id: 'r1', slug: data.slug }) },
    restaurantUser: { create: async () => ({}) },
    branch: { create: async ({ data }: any) => { h.branchData = data; return { id: 'b1' }; } },
    branchUser: { create: async () => ({}) },
    category: { create: async () => ({ id: 'c1' }) },
    menuItem: { create: async () => ({}) },
    restaurantTable: { createMany: async () => ({}) },
    riderProfile: { create: async () => ({}) },
  };
  return {
    prisma: {
      user: { findMany: async () => [] },
      restaurant: { findUnique: async () => null, findFirst: async () => null },
      branch: { findUnique: async () => null },
      $transaction: async (fn: any) => fn(tx),
    },
  };
});

import { POST } from '@/app/api/platform/restaurants/wizard/route';

const base = () => ({
  identity: { name: 'Spice Garden', commissionPct: 15 },
  brand: { mode: 'solo' },
  branch: { name: 'Main', line1: '12 MG Road', city: 'Bengaluru', postalCode: '560001', latitude: 12.97, longitude: 77.59 } as any,
  staff: [
    { role: 'ADMIN', email: 'owner@spice.in', tempPassword: 'abcdefgh12' },
    { role: 'KITCHEN', email: 'kitchen@spice.in', tempPassword: 'abcdefgh34' },
  ],
  seedStarterMenu: false,
});
const post = (body: unknown) => POST(new Request('http://x/api/platform/restaurants/wizard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any);

beforeEach(() => { h.branchData = null; });

describe('platform wizard onboarding fields', () => {
  it('writes FSSAI and 7 hour rows onto the first branch', async () => {
    const body = base();
    body.branch.fssaiLicenseNumber = '10020042007183';
    body.branch.hours = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openMin: 660, closeMin: 1380 }));
    const r = await post(body);
    expect(r.status).toBe(201);
    expect(h.branchData.fssaiLicenseNumber).toBe('10020042007183');
    expect(h.branchData.hours.create).toHaveLength(7);
  });

  it('keeps legacy behaviour when omitted (no hours, null FSSAI)', async () => {
    const r = await post(base());
    expect(r.status).toBe(201);
    expect(h.branchData.fssaiLicenseNumber).toBeNull();
    expect(h.branchData.hours).toBeUndefined();
  });

  it('rejects a malformed FSSAI number', async () => {
    const body = base();
    body.branch.fssaiLicenseNumber = '12345';
    expect((await post(body)).status).toBe(400);
  });
});
