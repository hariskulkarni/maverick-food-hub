/**
 * Route auth + wiring for the super-admin account-recovery endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
const mod = vi.hoisted(() => ({
  adminResetPassword: vi.fn(async () => ({ ok: true, generated: true, tempPassword: 'ABCD-EFGH-JKMN-PQRS' })),
  adminResetTotp: vi.fn(async () => ({ ok: true })),
  adminUnlock: vi.fn(async () => ({ ok: true })),
  adminSignOut: vi.fn(async () => ({ ok: true })),
  adminSetRole: vi.fn(async () => ({ ok: true, role: 'GUEST' })),
  adminSetSuspended: vi.fn(async () => ({ ok: false, status: 403, error: 'self_forbidden', message: 'no' })),
  getUserActivity: vi.fn(async () => ({ sessions: [], events: [] })),
}));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/platform-user-admin', () => mod);

import { POST } from '@/app/api/platform/users/[id]/admin/route';
import { GET as activity } from '@/app/api/platform/users/[id]/activity/route';

const ctx = { params: Promise.resolve({ id: 'u9' }) };
const post = (body: unknown) => POST(new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, ctx);

beforeEach(() => { vi.clearAllMocks(); session = { user: { id: 'su1', role: 'SUPER_ADMIN' } }; });

describe('POST /api/platform/users/[id]/admin', () => {
  it('401 anonymous, 403 for ADMIN and for delegated roles', async () => {
    session = null;
    expect((await post({ action: 'unlock' })).status).toBe(401);
    for (const role of ['ADMIN', 'ADMIN_ASSIST', 'KITCHEN']) {
      session = { user: { id: 'x', role } };
      expect((await post({ action: 'unlock' })).status).toBe(403);
    }
    expect(mod.adminUnlock).not.toHaveBeenCalled();
  });
  it('reset_password returns the temp password once with no-store', async () => {
    const r = await post({ action: 'reset_password' });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await r.json()).tempPassword).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(mod.adminResetPassword).toHaveBeenCalledWith({ id: 'su1', role: 'SUPER_ADMIN' }, 'u9', { password: undefined }, expect.anything());
  });
  it('dispatches each action', async () => {
    await post({ action: 'reset_totp' });
    await post({ action: 'sign_out' });
    await post({ action: 'set_role', role: 'GUEST' });
    expect(mod.adminResetTotp).toHaveBeenCalled();
    expect(mod.adminSignOut).toHaveBeenCalled();
    expect(mod.adminSetRole).toHaveBeenCalledWith(expect.anything(), 'u9', 'GUEST', expect.anything());
  });
  it('maps a guard failure to its status + message', async () => {
    const r = await post({ action: 'suspend', reason: 'x' });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'no', code: 'self_forbidden' });
  });
  it('400 on an unknown action or role', async () => {
    expect((await post({ action: 'nuke' })).status).toBe(400);
    expect((await post({ action: 'set_role', role: 'OWNER' })).status).toBe(400);
  });
});

describe('GET /api/platform/users/[id]/activity', () => {
  it('super admin only', async () => {
    expect((await activity(new Request('http://x/') as any, ctx)).status).toBe(200);
    session = { user: { id: 'x', role: 'ADMIN' } };
    expect((await activity(new Request('http://x/') as any, ctx)).status).toBe(403);
  });
});
