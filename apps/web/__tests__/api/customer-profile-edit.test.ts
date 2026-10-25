/**
 * Lead item 7: customers can edit their name / email (validated, email unique,
 * audited without contact details in clear beyond what changed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
const { db, auditFn } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
  auditFn: vi.fn(async (..._a: any[]) => {}),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/audit', () => ({ audit: auditFn }));

import { PATCH } from '@/app/api/customer/me/route';

const patch = (body: unknown) => PATCH(new Request('http://x/', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any);

beforeEach(() => {
  vi.clearAllMocks();
  session = { user: { id: 'c1', role: 'CUSTOMER' } };
  db.user.findUnique.mockResolvedValue({ id: 'c1', name: 'Old', email: 'old@x.com' });
  db.user.findFirst.mockResolvedValue(null);
  db.user.update.mockImplementation(async ({ data }: any) => ({ id: 'c1', name: data.name ?? 'Old', email: data.email ?? 'old@x.com', phone: '+91' }));
});

describe('PATCH /api/customer/me', () => {
  it('401 anonymous; 403 for non-customers (staff emails are login identifiers)', async () => {
    session = null;
    expect((await patch({ name: 'A' })).status).toBe(401);
    session = { user: { id: 'k1', role: 'KITCHEN' } };
    expect((await patch({ name: 'A' })).status).toBe(403);
  });
  it('updates name + lower-cased email, returns a DTO, audits', async () => {
    const r = await patch({ name: '  Asha K ', email: 'Asha@Example.com' });
    expect(r.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { name: 'Asha K', email: 'asha@example.com' } }));
    expect(await r.json()).toEqual({ ok: true, user: { id: 'c1', name: 'Asha K', email: 'asha@example.com', phone: '+91' } });
    expect(auditFn).toHaveBeenCalledWith('user.profile.update', expect.objectContaining({ entityId: 'c1', after: { fields: ['name', 'email'] } }));
  });
  it('409 when the email belongs to someone else', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'other' });
    const r = await patch({ email: 'taken@x.com' });
    expect(r.status).toBe(409);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('400 on invalid input; empty email clears it', async () => {
    expect((await patch({ email: 'not-an-email' })).status).toBe(400);
    expect((await patch({ name: '' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    await patch({ email: '' });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { email: null } }));
  });
});
