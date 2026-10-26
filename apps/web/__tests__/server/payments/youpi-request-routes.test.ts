import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  currentRestaurant: vi.fn(),
  accessibleSet: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  saveConfig: vi.fn(),
  getConfig: vi.fn(),
  audit: vi.fn(async () => undefined),
}));
vi.mock('@/server/tenancy', () => ({ currentRestaurant: h.currentRestaurant, accessibleSet: h.accessibleSet }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/db', () => ({
  prisma: { youpiFeatureRequest: { findUnique: h.findUnique, upsert: h.upsert } },
}));
vi.mock('@/server/integrations', () => ({ saveConfig: h.saveConfig, getConfig: h.getConfig }));

import { POST as requestPOST } from '@/app/api/admin/youpi/request/route';
import { POST as vpaPOST } from '@/app/api/admin/youpi/vpa/route';

const req = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as any;

/** Caller is global `role`, with `tenantRole` inside restaurant r1. */
function asUser(role: string, tenantRole: string | null = role) {
  h.auth.mockResolvedValue({ user: { id: 'u1', role } });
  h.currentRestaurant.mockResolvedValue(role === 'ADMIN' || role === 'KITCHEN' ? { id: 'r1' } : null);
  h.accessibleSet.mockResolvedValue(new Map(tenantRole ? [['r1', { role: tenantRole }]] : []));
}

beforeEach(() => {
  vi.clearAllMocks();
  asUser('ADMIN');
  h.getConfig.mockResolvedValue(null);
  h.upsert.mockResolvedValue({ id: 'fr1', status: 'REQUESTED' });
});

describe('POST /api/admin/youpi/request', () => {
  it('creates a REQUESTED row scoped to the restaurant and audits it', async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await requestPOST();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('REQUESTED');
    const arg = h.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ restaurantId: 'r1' });
    expect(arg.create).toMatchObject({ restaurantId: 'r1', status: 'REQUESTED', requestedById: 'u1' });
    expect(h.audit).toHaveBeenCalledWith('youpi.request', expect.objectContaining({ actorId: 'u1', restaurantId: 'r1' }));
  });
  it('409 when already APPROVED, no write', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const res = await requestPOST();
    expect(res.status).toBe(409);
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('idempotent when already REQUESTED', async () => {
    h.findUnique.mockResolvedValue({ status: 'REQUESTED' });
    const res = await requestPOST();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('REQUESTED');
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('REJECTED or DISABLED needs a super-admin reset first (T-15)', async () => {
    for (const status of ['REJECTED', 'DISABLED']) {
      h.findUnique.mockResolvedValue({ status });
      const res = await requestPOST();
      expect(res.status).toBe(409);
    }
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('KITCHEN is refused', async () => {
    asUser('KITCHEN');
    const res = await requestPOST();
    expect(res.status).toBe(403);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/youpi/vpa (T-04)', () => {
  it('403 unless APPROVED', async () => {
    for (const s of [null, 'REQUESTED', 'REJECTED', 'DISABLED']) {
      h.findUnique.mockResolvedValue(s ? { status: s } : null);
      const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
      expect(res.status).toBe(403);
    }
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
  it('400 on invalid vpa', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const res = await vpaPOST(req({ receivingVpa: 'not a vpa' }));
    expect(res.status).toBe(400);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
  it('records a pending request and never changes the effective receivingVpa', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    h.getConfig.mockResolvedValue({ foo: 'bar', receivingVpa: 'old@okbank' });
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'PENDING_VERIFICATION', pendingReceivingVpa: 'shop@okbank' });
    expect(h.findUnique).toHaveBeenCalledWith({ where: { restaurantId: 'r1' } });
    const [rid, provider, cfg] = h.saveConfig.mock.calls[0];
    expect([rid, provider]).toEqual(['r1', 'YOUPI']);
    expect(cfg).toMatchObject({
      foo: 'bar',
      receivingVpa: 'old@okbank',
      pendingReceivingVpa: 'shop@okbank',
      pendingReceivingVpaRequestedById: 'u1',
    });
    expect(h.audit).toHaveBeenCalledWith(
      'youpi.vpa.change_requested',
      expect.objectContaining({
        actorId: 'u1',
        restaurantId: 'r1',
        after: expect.objectContaining({ receivingVpa: 'old@okbank', pendingReceivingVpa: 'shop@okbank' }),
      }),
    );
  });
  it('KITCHEN (global role) is refused, nothing saved', async () => {
    asUser('KITCHEN');
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
    expect(res.status).toBe(403);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
  it('global ADMIN who is only KITCHEN on this restaurant is refused', async () => {
    asUser('ADMIN', 'KITCHEN');
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
    expect(res.status).toBe(403);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
  it('a body restaurantId cannot redirect the write to another tenant', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    await vpaPOST(req({ receivingVpa: 'shop@okbank', restaurantId: 'r2' }));
    expect(h.saveConfig.mock.calls[0][0]).toBe('r1');
  });
  it('SUPER_ADMIN cannot use the tenant route (onboarding goes through /platform)', async () => {
    asUser('SUPER_ADMIN', null);
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank', restaurantId: 'r1' }));
    expect(res.status).toBe(403);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
  it('unauthenticated -> 401', async () => {
    h.auth.mockResolvedValue(null);
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
    expect(res.status).toBe(401);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
});
