/**
 * H31 — ?force=1 must refuse to hard-delete a restaurant that has financial
 * records (would orphan wallet/loyalty/bonus ledgers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let orderCount = 5; let financial = 0; let deleted = false;

vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'su', role: 'SUPER_ADMIN' } }) }));
vi.mock('@/server/revalidate', () => ({ revalidateRestaurantSurfaces: vi.fn() }));
vi.mock('@/server/db', () => ({
  prisma: {
    restaurant: { findUnique: async () => ({ slug: 'r' }), delete: async () => ({}) },
    branch: { findMany: async () => [{ id: 'b1' }] },
    order: { count: async () => orderCount, deleteMany: async () => { deleted = true; return {}; } },
    payment: { count: async () => financial }, refund: { count: async () => 0 }, codCollection: { count: async () => 0 },
    walletTransaction: { count: async () => 0 }, loyaltyTransaction: { count: async () => 0 }, signupBonusLedger: { count: async () => 0 },
    $transaction: async (fn: any) => fn({ order: { deleteMany: async () => { deleted = true; return {}; } }, branch: { deleteMany: async () => ({}) }, restaurant: { delete: async () => ({}) } })
  }
}));

import { DELETE } from '@/app/api/platform/restaurants/[id]/route';
const del = (force: boolean) => DELETE(new Request(`http://x/api/platform/restaurants/r1${force ? '?force=1' : ''}`, { method: 'DELETE' }) as any, { params: Promise.resolve({ id: 'r1' }) });

beforeEach(() => { orderCount = 5; financial = 0; deleted = false; });

describe('H31: force-delete financial guard', () => {
  it('409 has_orders without force', async () => { const r = await del(false); expect(r.status).toBe(409); expect((await r.json()).error).toBe('has_orders'); expect(deleted).toBe(false); });
  it('409 has_financial_history with force when payments exist', async () => { financial = 3; const r = await del(true); expect(r.status).toBe(409); expect((await r.json()).error).toBe('has_financial_history'); expect(deleted).toBe(false); });
  it('allows force-delete when no financial rows', async () => { financial = 0; const r = await del(true); expect(r.status).toBe(200); expect(deleted).toBe(true); });
});
