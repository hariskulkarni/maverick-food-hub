/**
 * /api/platform/users/test-accounts — SUPER_ADMIN + 2FA only, audited, and the
 * same server guards as scripts/test-account.ts (real users' phones refused).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  gate: { ok: { userId: 'sa1', email: 'owner@flavrly.in', name: 'Owner' } } as any,
  audit: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    userSession: { updateMany: vi.fn(), create: vi.fn() },
    riderProfile: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/server/observability/access', () => ({ superAdmin2faSession: async () => h.gate }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }), clientIp: () => '203.0.113.5' }));

import { GET, POST, DELETE } from '@/app/api/platform/users/test-accounts/route';

const req = (method: string, body?: unknown) =>
  new Request('https://portal.flavrly.in/api/platform/users/test-accounts', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { ok: { userId: 'sa1', email: 'owner@flavrly.in', name: 'Owner' } };
  h.prisma.$transaction.mockImplementation(async (fn: any) => fn(h.prisma));
  h.prisma.userSession.create.mockResolvedValue({ id: 'marker' });
  h.audit.mockResolvedValue(undefined);
});

describe('authz', () => {
  it('401 without a session, 403 for non-super-admins and for a super-admin without a 2FA session', async () => {
    h.gate = { deny: 'unauthenticated' };
    expect((await GET()).status).toBe(401);
    h.gate = { deny: 'role' };
    expect((await POST(req('POST', { phone: '8500947947', role: 'RIDER' }))).status).toBe(403);
    h.gate = { deny: '2fa' };
    const r = await DELETE(req('DELETE', { phone: '8500947947' }));
    expect(r.status).toBe(403);
    expect((await r.json()).error ?? '').toMatch(/2FA|Authenticator/i);
    expect(h.prisma.user.create).not.toHaveBeenCalled();
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('create / delete', () => {
  it('creates a test rider and audits it', async () => {
    h.prisma.user.findUnique.mockResolvedValue(null);
    h.prisma.user.create.mockResolvedValue({ id: 'r1' });
    const r = await POST(req('POST', { phone: '+918500947947', role: 'RIDER' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, phone: '+918500947947' });
    expect(h.audit).toHaveBeenCalledWith('user.test_account.create', expect.objectContaining({ actorId: 'sa1', entityId: 'r1' }));
  });

  it('refuses a phone owned by a real user (409, nothing written, no audit)', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ id: 'c1', role: 'CUSTOMER', deletedAt: null, isTestAccount: false });
    const r = await POST(req('POST', { phone: '9876500001', role: 'CUSTOMER' }));
    expect(r.status).toBe(409);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
    expect(h.prisma.user.create).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('rejects an invalid body', async () => {
    expect((await POST(req('POST', { phone: '8500947947', role: 'ADMIN' }))).status).toBe(400);
  });

  it('deletes a test account and audits it', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ id: 'r1', role: 'RIDER', isTestAccount: true });
    const r = await DELETE(req('DELETE', { phone: '8500947947' }));
    expect(r.status).toBe(200);
    expect(h.prisma.user.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isTestAccount: false, deletedAt: expect.any(Date) } });
    expect(h.audit).toHaveBeenCalledWith('user.test_account.delete', expect.objectContaining({ entityId: 'r1' }));
  });

  it('delete of a non-test account is refused (404)', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ id: 'c1', role: 'CUSTOMER', isTestAccount: false });
    expect((await DELETE(req('DELETE', { phone: '9876500001' }))).status).toBe(404);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });

  it('lists test accounts', async () => {
    h.prisma.user.findMany.mockResolvedValue([
      { id: 'r1', phone: '+918500947947', name: 'Flavrly Test Rider', role: 'RIDER', createdAt: new Date(), deletedAt: null, suspendedAt: null },
    ]);
    const body = await (await GET()).json();
    expect(body.accounts[0]).toMatchObject({ phone: '+918500947947', role: 'RIDER', deletedAt: null });
  });
});
