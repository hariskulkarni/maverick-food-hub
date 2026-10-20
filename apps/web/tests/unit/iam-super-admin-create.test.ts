import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  session: null as any,
  findUnique: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/server/auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/db', () => ({ prisma: { user: { findUnique: m.findUnique, create: m.create } } }));
vi.mock('@/server/audit', () => ({ audit: (...a: unknown[]) => m.audit(...a) }));

import { POST } from '@/app/api/platform/iam/super-admins/route';

const PW = 'correct-horse-battery';
const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as any;
const good = { name: 'Root Two', email: '  Root.Two@Flavrly.IN ', password: PW };

beforeEach(() => {
  Object.values(m).forEach((f) => typeof f === 'function' && (f as any).mockReset?.());
  m.session = { user: { id: 'sa1', role: 'SUPER_ADMIN' } };
  m.audit.mockResolvedValue(undefined);
  m.findUnique.mockResolvedValue(null);
  m.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', email: data.email, role: data.role }));
});

describe('POST /api/platform/iam/super-admins', () => {
  it.each([
    ['ADMIN_ASSIST'], ['DEVELOPER'], ['ADMIN'], ['CUSTOMER'],
  ])('403 for %s and creates nothing', async (role) => {
    m.session = { user: { id: 'x', role } };
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    m.session = null;
    const res = await POST(req(good));
    expect(res.status).toBe(401);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('409 on duplicate email', async () => {
    m.findUnique.mockResolvedValue({ id: 'e1' });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/already exists/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('400 for password < 12', async () => {
    const res = await POST(req({ ...good, password: 'short-pw-11' }));
    expect(res.status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('400 for bad email / empty name', async () => {
    expect((await POST(req({ ...good, email: 'nope' }))).status).toBe(400);
    expect((await POST(req({ ...good, name: '' }))).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('creates SUPER_ADMIN, hashes password, never returns/logs it, audits', async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(201);
    const data = m.create.mock.calls[0][0].data;
    expect(data.role).toBe('SUPER_ADMIN');
    expect(data.email).toBe('root.two@flavrly.in');
    expect(data.passwordHash).toMatch(/^\$argon2/);
    expect(data.passwordHash).not.toContain(PW);
    expect(data.totpEnabledAt ?? null).toBeNull();

    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(PW);
    expect(text).not.toContain('argon2');
    expect(JSON.parse(text)).toEqual({ ok: true, user: { id: 'n1', email: 'root.two@flavrly.in', role: 'SUPER_ADMIN' } });

    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][0]).toBe('iam.superadmin.create');
    const logged = JSON.stringify(m.audit.mock.calls);
    expect(logged).not.toContain(PW);
    expect(logged).not.toContain('argon2');
  });
});
