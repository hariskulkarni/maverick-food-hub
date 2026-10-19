/**
 * H24 — rider-application approval must never flip an existing privileged user to
 * RIDER. Allow-list: only an unclaimed phone or an existing CUSTOMER/RIDER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let existingUser: any = null;
const calls: string[] = [];

vi.mock('@/server/tenancy', () => ({ requireRestaurant: async () => ({ id: 'rest1', name: 'R' }) }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('@/lib/brand', () => ({ brand: { name: 'Flavrly' } }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderApplication: { findUnique: async () => ({ id: 'app1', restaurantId: 'rest1', status: 'PENDING', phone: '+9199', name: 'Rider', vehicleType: 'BIKE', vehicleNumber: 'KA01' }), update: async () => { calls.push('app.update'); return {}; } },
    branch: { findFirst: async () => ({ id: 'b1', restaurantId: 'rest1' }) },
    user: {
      findUnique: async () => existingUser,
      update: async () => { calls.push('user.update'); return { id: 'u1' }; },
      create: async () => { calls.push('user.create'); return { id: 'u-new' }; }
    },
    riderProfile: { upsert: async () => ({}) }
  }
}));

import { POST } from '@/app/api/admin/rider-applications/[id]/approve/route';
const post = () => POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branchId: 'b1' }) }) as any, { params: Promise.resolve({ id: 'app1' }) });

beforeEach(() => { existingUser = null; calls.length = 0; });

describe('H24: rider approval promotion guard', () => {
  it('refuses to flip a SUPER_ADMIN to RIDER (409, no writes)', async () => {
    existingUser = { id: 'su', phone: '+9199', role: 'SUPER_ADMIN', name: 'Boss' };
    const res = await post();
    expect(res.status).toBe(409);
    expect(calls).not.toContain('user.update');
    expect(calls).not.toContain('app.update');
  });
  it('refuses an ADMIN phone too', async () => {
    existingUser = { id: 'a', phone: '+9199', role: 'ADMIN', name: 'A' };
    expect((await post()).status).toBe(409);
  });
  it('creates a RIDER for an unclaimed phone', async () => {
    existingUser = null;
    const res = await post();
    expect(res.status).toBe(200);
    expect(calls).toContain('user.create');
  });
  it('promotes an existing CUSTOMER', async () => {
    existingUser = { id: 'c', phone: '+9199', role: 'CUSTOMER', name: 'C' };
    const res = await post();
    expect(res.status).toBe(200);
    expect(calls).toContain('user.update');
  });
});
