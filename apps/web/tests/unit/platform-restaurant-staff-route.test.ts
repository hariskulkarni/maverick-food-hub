import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  restFind: vi.fn(),
  userFind: vi.fn(),
  userCreate: vi.fn(),
  ruCreate: vi.fn(),
  audit: vi.fn()
}));

vi.mock('@/server/tenancy', () => ({ requireSuperAdmin: m.requireSuperAdmin }));
vi.mock('@/server/audit', () => ({ audit: m.audit }));
vi.mock('@/server/http/rate-limit', () => ({ clientIp: () => '1.2.3.4' }));
vi.mock('@/server/db', () => {
  const tx = { user: { create: m.userCreate }, restaurantUser: { create: m.ruCreate } };
  return {
    prisma: {
      restaurant: { findUnique: m.restFind },
      user: { findUnique: m.userFind },
      $transaction: async (fn: any) => fn(tx)
    }
  };
});

import { POST } from '@/app/api/platform/restaurants/[id]/staff/route';

const ctx = { params: Promise.resolve({ id: 'r1' }) };
const good = { name: 'Asha', email: ' Asha@Example.COM ', password: 'correct-horse-12', role: 'KITCHEN' };
const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers({ 'user-agent': 'vt' }) }) as any;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.requireSuperAdmin.mockResolvedValue({ user: { id: 'sa1', role: 'SUPER_ADMIN' } });
  m.restFind.mockResolvedValue({ id: 'r1' });
  m.userFind.mockResolvedValue(null);
  m.userCreate.mockResolvedValue({ id: 'u9', email: 'asha@example.com', role: 'KITCHEN' });
  m.ruCreate.mockResolvedValue({ id: 'ru1' });
  m.audit.mockResolvedValue(undefined);
});

describe('POST /api/platform/restaurants/[id]/staff', () => {
  it('403 for non-super-admin and performs no writes', async () => {
    m.requireSuperAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }));
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(403);
    expect(m.userCreate).not.toHaveBeenCalled();
    expect(m.ruCreate).not.toHaveBeenCalled();
    expect(m.restFind).not.toHaveBeenCalled();
  });

  it('404 for unknown restaurant', async () => {
    m.restFind.mockResolvedValue(null);
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(404);
    expect(m.userCreate).not.toHaveBeenCalled();
  });

  it('409 for duplicate email, no writes', async () => {
    m.userFind.mockResolvedValue({ id: 'existing' });
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(409);
    expect(m.userFind).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'asha@example.com' } }));
    expect(m.userCreate).not.toHaveBeenCalled();
    expect(m.ruCreate).not.toHaveBeenCalled();
  });

  it('400 for weak password', async () => {
    const res = await POST(req({ ...good, password: 'short' }), ctx);
    expect(res.status).toBe(400);
    expect(m.userCreate).not.toHaveBeenCalled();
  });

  it('400 for disallowed role (SUPER_ADMIN)', async () => {
    const res = await POST(req({ ...good, role: 'SUPER_ADMIN' }), ctx);
    expect(res.status).toBe(400);
    expect(m.userCreate).not.toHaveBeenCalled();
  });

  it('creates user + restaurantUser with the role; never returns or logs the password', async () => {
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, user: { id: 'u9', email: 'asha@example.com', role: 'KITCHEN' } });
    expect(text).not.toContain('correct-horse-12');
    expect(text).not.toMatch(/hash/i);

    const ud = m.userCreate.mock.calls[0][0].data;
    expect(ud.email).toBe('asha@example.com');
    expect(ud.role).toBe('KITCHEN');
    expect(ud.passwordHash).toMatch(/^\$argon2/);
    expect(ud.passwordHash).not.toContain('correct-horse-12');
    expect(m.ruCreate).toHaveBeenCalledWith({ data: { restaurantId: 'r1', userId: 'u9', role: 'KITCHEN' } });

    expect(m.audit).toHaveBeenCalledWith('platform.restaurant.staff.create', expect.objectContaining({ restaurantId: 'r1', actorId: 'sa1' }));
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('correct-horse-12');
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('argon2');
  });
});
