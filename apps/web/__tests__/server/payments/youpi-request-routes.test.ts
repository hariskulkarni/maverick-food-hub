import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  require: vi.fn(),
  auth: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  saveConfig: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.require }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/db', () => ({
  prisma: { youpiFeatureRequest: { findUnique: h.findUnique, upsert: h.upsert } },
}));
vi.mock('@/server/integrations', () => ({ saveConfig: h.saveConfig, getConfig: h.getConfig }));

import { POST as requestPOST } from '@/app/api/admin/youpi/request/route';
import { POST as vpaPOST } from '@/app/api/admin/youpi/vpa/route';

const req = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.require.mockResolvedValue({ id: 'r1' });
  h.auth.mockResolvedValue({ user: { id: 'u1' } });
  h.getConfig.mockResolvedValue(null);
  h.upsert.mockResolvedValue({ status: 'REQUESTED' });
});

describe('POST /api/admin/youpi/request', () => {
  it('creates a REQUESTED row scoped to the restaurant', async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await requestPOST(req({}));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('REQUESTED');
    const arg = h.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ restaurantId: 'r1' });
    expect(arg.create).toMatchObject({ restaurantId: 'r1', status: 'REQUESTED', requestedById: 'u1' });
  });
  it('409 when already APPROVED, no write', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const res = await requestPOST(req({}));
    expect(res.status).toBe(409);
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('idempotent when already REQUESTED', async () => {
    h.findUnique.mockResolvedValue({ status: 'REQUESTED' });
    const res = await requestPOST(req({}));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('REQUESTED');
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/youpi/vpa', () => {
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
  it('saves YOUPI config for valid vpa when APPROVED', async () => {
    h.findUnique.mockResolvedValue({ status: 'APPROVED' });
    h.getConfig.mockResolvedValue({ foo: 'bar' });
    const res = await vpaPOST(req({ receivingVpa: 'shop@okbank' }));
    expect(res.status).toBe(200);
    expect(h.findUnique).toHaveBeenCalledWith({ where: { restaurantId: 'r1' } });
    expect(h.saveConfig).toHaveBeenCalledWith(
      'r1', 'YOUPI', { foo: 'bar', receivingVpa: 'shop@okbank' }, { status: 'CONNECTED' },
    );
  });
});
