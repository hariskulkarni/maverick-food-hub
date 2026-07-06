/**
 * Maker-checker approvals (server/approvals.ts). Mocks the prisma singleton +
 * auth (same pattern as the other server tests) and exercises the real
 * permission matrix so the branch (execute vs request vs deny) is genuine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
const calls: any[] = [];
const store: Record<string, any> = {};

vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/revalidate', () => ({ revalidateRestaurantSurfaces: vi.fn() }));
vi.mock('@/server/db', () => ({
  prisma: {
    restaurant: {
      findUnique: async () => ({ name: 'Testaurant', slug: 'testaurant', deletedAt: null }),
      update: async ({ where, data }: any) => { calls.push(['restaurant.update', where.id, data]); return { id: where.id, slug: 'testaurant', status: data.status ?? 'ACTIVE' }; },
    },
    approvalRequest: {
      create: async ({ data }: any) => { const id = 'ar_' + Object.keys(store).length; store[id] = { id, ...data }; calls.push(['ar.create', data.status]); return store[id]; },
      findUnique: async ({ where }: any) => store[where.id] ?? null,
      update: async ({ where, data }: any) => { store[where.id] = { ...store[where.id], ...data }; return store[where.id]; },
    },
  },
}));

import { confidentialAction, approveRequest, rejectRequest, APPROVAL_ACTIONS, isApprovalAction } from '@/server/approvals';

const req = () => new Request('http://x');
beforeEach(() => { calls.length = 0; });

describe('approval registry', () => {
  it('registers restaurant suspend + archive as confidential', () => {
    expect(isApprovalAction('restaurant.suspend')).toBe(true);
    expect(isApprovalAction('restaurant.archive')).toBe(true);
    expect(isApprovalAction('nope')).toBe(false);
    for (const def of Object.values(APPROVAL_ACTIONS)) {
      expect(['restaurants:write', 'finance:write', 'iam:manage']).toContain(def.capability);
    }
  });
});

describe('confidentialAction — maker-checker branch', () => {
  it('SUPER_ADMIN executes directly (200)', async () => {
    session = { user: { id: 'su1', role: 'SUPER_ADMIN' } };
    const res = await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executed).toBe(true);
    expect(calls.some((c) => c[0] === 'restaurant.update' && c[1] === 'r1')).toBe(true);
    expect(calls.some((c) => c[0] === 'ar.create')).toBe(false);
  });

  it('ADMIN_ASSIST creates a pending request (202), no execution', async () => {
    session = { user: { id: 'aa1', role: 'ADMIN_ASSIST' } };
    const res = await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r2' });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.pending).toBe(true);
    expect(body.approvalId).toBeTruthy();
    expect(calls.some((c) => c[0] === 'ar.create' && c[1] === 'PENDING')).toBe(true);
    expect(calls.some((c) => c[0] === 'restaurant.update')).toBe(false);
  });

  it('GUEST is forbidden (403)', async () => {
    session = { user: { id: 'g1', role: 'GUEST' } };
    const res = await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r3' });
    expect(res.status).toBe(403);
  });

  it('no session is unauthorized (401)', async () => {
    session = null;
    const res = await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r3' });
    expect(res.status).toBe(401);
  });
});

describe('approve / reject', () => {
  it('approving a pending request executes it and marks APPROVED', async () => {
    session = { user: { id: 'aa1', role: 'ADMIN_ASSIST' } };
    const body = await (await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r5' })).json();
    calls.length = 0;
    const out = await approveRequest(body.approvalId, { id: 'su1', role: 'SUPER_ADMIN' });
    expect(out.ok).toBe(true);
    expect(calls.some((c) => c[0] === 'restaurant.update' && c[1] === 'r5')).toBe(true);
    expect(store[body.approvalId].status).toBe('APPROVED');
    expect(store[body.approvalId].executedAt).toBeTruthy();
  });

  it('cannot approve a non-pending request twice', async () => {
    session = { user: { id: 'aa1', role: 'ADMIN_ASSIST' } };
    const body = await (await confidentialAction(req(), 'restaurant.suspend', { restaurantId: 'r6' })).json();
    await approveRequest(body.approvalId, { id: 'su1' });
    const again = await approveRequest(body.approvalId, { id: 'su1' });
    expect(again.ok).toBe(false);
    expect((again as any).error).toBe('not_pending');
  });

  it('rejecting records REJECTED + note; missing id → not_found', async () => {
    session = { user: { id: 'aa1', role: 'ADMIN_ASSIST' } };
    const body = await (await confidentialAction(req(), 'restaurant.archive', { restaurantId: 'r7' })).json();
    const rej = await rejectRequest(body.approvalId, { id: 'su1', role: 'SUPER_ADMIN' }, 'not now');
    expect(rej.ok).toBe(true);
    expect(store[body.approvalId].status).toBe('REJECTED');
    expect(store[body.approvalId].reviewNote).toBe('not now');
    const nf = await rejectRequest('missing', { id: 'su1' });
    expect(nf.ok).toBe(false);
    expect((nf as any).error).toBe('not_found');
  });
});
