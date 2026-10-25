/**
 * The platform user + restaurant detail APIs must never ship password hashes
 * or TOTP secrets to the browser; PATCH suspension goes through the guarded
 * admin action (self-suspend refused).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = { user: { id: 'su1', role: 'SUPER_ADMIN' } };
const SECRET_ROW = {
  id: 'u1', name: 'K', email: 'k@x.com', phone: null, role: 'KITCHEN', createdAt: new Date(),
  suspendedAt: null, suspendedReason: null, deletedAt: null, totpEnabledAt: new Date(), mustChangePassword: false,
  passwordHash: '$argon2id$secret', totpSecret: 'enc-secret', totpPendingSecret: 'enc-pending',
};
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  order: { findMany: vi.fn(async () => []), aggregate: vi.fn(async () => ({ _sum: { total: 0 }, _count: 0 })) },
  payment: { findMany: vi.fn(async () => []) },
  wallet: { findUnique: vi.fn(async () => null) },
  loyaltyAccount: { findUnique: vi.fn(async () => null) },
  address: { findMany: vi.fn(async () => []) },
  notificationLog: { findMany: vi.fn(async () => []) },
  riderProfile: { findUnique: vi.fn(async () => null) },
  restaurant: { findUnique: vi.fn() },
  orderItem: { groupBy: vi.fn(async () => []) },
  menuItem: { findMany: vi.fn(async () => []) },
  $transaction: vi.fn(async (fn: any) => fn({})),
}));
const admin = vi.hoisted(() => ({ adminSetSuspended: vi.fn(async () => ({ ok: false, status: 403, error: 'self_forbidden', message: 'Not on yourself.' })) }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/revalidate', () => ({ revalidateRestaurantSurfaces: vi.fn() }));
vi.mock('@/server/platform-user-admin', () => admin);

import { GET as getUser, PATCH as patchUser } from '@/app/api/platform/users/[id]/route';
import { GET as getRestaurant } from '@/app/api/platform/restaurants/[id]/route';

const ctx = { params: Promise.resolve({ id: 'u1' }) };
beforeEach(() => { vi.clearAllMocks(); session = { user: { id: 'su1', role: 'SUPER_ADMIN' } }; });

describe('GET /api/platform/users/[id]', () => {
  it('returns a DTO without secrets', async () => {
    db.user.findUnique.mockImplementation(async ({ select }: any) => {
      // emulate Prisma select
      return Object.fromEntries(Object.keys(select).map((k) => [k, (SECRET_ROW as any)[k]]));
    });
    const body = JSON.stringify(await (await getUser(new Request('http://x/') as any, ctx)).json());
    expect(body).not.toContain('argon2');
    expect(body).not.toContain('enc-secret');
    expect(body).not.toContain('enc-pending');
    expect(body).toContain('"hasPassword":true');
    expect(body).toContain('"totpEnrolled":true');
  });
});

describe('PATCH /api/platform/users/[id] suspension', () => {
  it('goes through the guarded admin action and surfaces its refusal', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'su1', suspendedAt: null });
    const r = await patchUser(new Request('http://x/', { method: 'PATCH', body: JSON.stringify({ suspended: true }) }) as any, { params: Promise.resolve({ id: 'su1' }) });
    expect(r.status).toBe(403);
    expect(admin.adminSetSuspended).toHaveBeenCalledWith(expect.objectContaining({ id: 'su1' }), 'su1', true, undefined, expect.anything());
  });
});

describe('GET /api/platform/restaurants/[id]', () => {
  it('selects only safe owner fields', async () => {
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', branches: [], owner: { id: 'o1' } });
    await getRestaurant(new Request('http://x/') as any, { params: Promise.resolve({ id: 'r1' }) });
    const owner = db.restaurant.findUnique.mock.calls[0][0].include.owner;
    expect(owner).toEqual({ select: { id: true, name: true, email: true, phone: true, role: true } });
  });
});
