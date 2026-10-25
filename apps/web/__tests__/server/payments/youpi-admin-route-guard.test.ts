import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  testAndSave: vi.fn(async () => ({ ok: true, detail: 'ok' })),
  disconnect: vi.fn(async () => undefined),
  getConfig: vi.fn(async () => null),
}));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', role: 'ADMIN' } })) }));
vi.mock('@/server/tenancy', async () => ({ requireManagedRestaurant: vi.fn(async () => ({ id: 'r1', name: 'R' })), ...(await import('../../helpers/tenant-admin-mock')).tenantAdminMocks(() => (vi.fn(async () => ({ id: 'r1', name: 'R' })))()) }));
vi.mock('@/server/integrations', () => h);
vi.mock('@/server/alerts', () => ({ maskCredentials: (x: any) => x, sendIntegrationAlert: vi.fn(async () => undefined) }));
vi.mock('@/server/db', () => ({ prisma: { integrationCredential: { findUnique: vi.fn(async () => null) } } }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn() } }));

import { PUT, DELETE } from '@/app/api/admin/integrations/[provider]/route';

const mk = (method: string, body?: unknown) =>
  ({ nextUrl: new URL('http://x/api/admin/integrations/p'), json: async () => body, method }) as any;
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });

describe('admin integrations route blocks YOUPI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PUT YOUPI -> 403, no save', async () => {
    const res = await PUT(mk('PUT', { config: { baseUrl: 'x' } }), ctx('YOUPI'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/approval flow/);
    expect(h.testAndSave).not.toHaveBeenCalled();
  });

  it('DELETE YOUPI -> 403, no disconnect', async () => {
    const res = await DELETE(mk('DELETE'), ctx('YOUPI'));
    expect(res.status).toBe(403);
    expect(h.disconnect).not.toHaveBeenCalled();
  });

  it('PHONEPE still works', async () => {
    const del = await DELETE(mk('DELETE'), ctx('PHONEPE'));
    expect(del.status).toBe(200);
    expect(h.disconnect).toHaveBeenCalledWith('r1', 'PHONEPE');
  });
});
