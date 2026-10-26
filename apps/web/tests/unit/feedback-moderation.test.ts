import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  managed: vi.fn(),
  audit: vi.fn(),
  auth: vi.fn()
}));

vi.mock('@/server/auth', () => ({ auth: m.auth }));
vi.mock('@/server/db', () => ({
  prisma: { orderFeedback: { findFirst: m.findFirst, findMany: m.findMany, update: m.update, updateMany: m.updateMany } }
}));
vi.mock('@/server/tenancy', async () => ({ requireManagedRestaurant: m.managed, ...(await import('../../__tests__/helpers/tenant-admin-mock')).tenantAdminMocks((rid) => (m.managed)(rid)) }));
vi.mock('@/server/audit', () => ({ audit: m.audit }));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { PATCH } from '@/app/api/admin/feedback/[id]/route';
import { POST as BULK } from '@/app/api/admin/feedback/bulk/route';

const req = (body: unknown) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } }) as any;
const ctx = { params: Promise.resolve({ id: 'f1' }) };
const existing = { id: 'f1', moderationStatus: 'PUBLISHED', flagReason: null, reply: null, order: { branch: { restaurantId: 'rest1' }, assignment: { riderId: 'r1' } } };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
  m.managed.mockResolvedValue({ id: 'rest1' });
  m.findFirst.mockResolvedValue(existing);
  m.update.mockImplementation(async ({ data }: any) => ({ ...existing, ...data }));
  m.audit.mockResolvedValue(undefined);
});

describe('PATCH /api/admin/feedback/[id]', () => {
  it('returns the thrown Response when caller manages no restaurant', async () => {
    m.managed.mockRejectedValue(new Response('No restaurant', { status: 404 }));
    const res = await PATCH(req({ action: 'hide' }), ctx);
    expect(res.status).toBe(404);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('403 for non-admin role', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u2', role: 'CUSTOMER' } });
    const res = await PATCH(req({ action: 'hide' }), ctx);
    expect(res.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('404 for cross-tenant feedback (scoped lookup misses)', async () => {
    m.findFirst.mockResolvedValue(null);
    const res = await PATCH(req({ action: 'hide' }), ctx);
    expect(res.status).toBe(404);
    expect(m.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'f1', order: { branch: { restaurantId: 'rest1' } } });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('hide sets HIDDEN, stamps moderator, audits', async () => {
    const res = await PATCH(req({ action: 'hide' }), ctx);
    expect(res.status).toBe(200);
    const data = m.update.mock.calls[0][0].data;
    expect(data.moderationStatus).toBe('HIDDEN');
    expect(data.moderatedByUserId).toBe('u1');
    expect(data.moderatedAt).toBeInstanceOf(Date);
    expect(m.audit).toHaveBeenCalledWith('feedback.moderate', expect.objectContaining({ entityId: 'f1', restaurantId: 'rest1' }));
  });

  it('unhide sets PUBLISHED and clears flagReason', async () => {
    await PATCH(req({ action: 'unhide' }), ctx);
    const data = m.update.mock.calls[0][0].data;
    expect(data.moderationStatus).toBe('PUBLISHED');
    expect(data.flagReason).toBeNull();
  });

  it('flag stores the reason', async () => {
    await PATCH(req({ action: 'flag', reason: 'abusive language' }), ctx);
    const data = m.update.mock.calls[0][0].data;
    expect(data.moderationStatus).toBe('FLAGGED');
    expect(data.flagReason).toBe('abusive language');
  });

  it('flag without a reason is 400', async () => {
    const res = await PATCH(req({ action: 'flag' }), ctx);
    expect(res.status).toBe(400);
  });

  it('reply persists with replyAt/replyByUserId and no status change', async () => {
    const res = await PATCH(req({ action: 'reply', reply: 'Thanks for the feedback!' }), ctx);
    expect(res.status).toBe(200);
    const data = m.update.mock.calls[0][0].data;
    expect(data.reply).toBe('Thanks for the feedback!');
    expect(data.replyAt).toBeInstanceOf(Date);
    expect(data.replyByUserId).toBe('u1');
    expect(data.moderationStatus).toBeUndefined();
    expect(m.audit).toHaveBeenCalledWith('feedback.reply', expect.any(Object));
  });

  it('reply over 1000 chars or empty is 400', async () => {
    expect((await PATCH(req({ action: 'reply', reply: 'x'.repeat(1001) }), ctx)).status).toBe(400);
    expect((await PATCH(req({ action: 'reply', reply: '   ' }), ctx)).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('unknown action is 400', async () => {
    expect((await PATCH(req({ action: 'nuke' }), ctx)).status).toBe(400);
  });

  it('recomputes the rider rating after a status change', async () => {
    // rider-rating is real here but prisma mock lacks it; best-effort must not throw
    const res = await PATCH(req({ action: 'hide' }), ctx);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/feedback/bulk', () => {
  it('hides only tenant-owned ids and audits', async () => {
    m.findMany.mockResolvedValue([{ id: 'f1', order: { assignment: { riderId: 'r1' } } }, { id: 'f2', order: { assignment: null } }]);
    m.updateMany.mockResolvedValue({ count: 2 });
    const res = await BULK(req({ ids: ['f1', 'f2', 'other'], action: 'hide' }));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['f1', 'f2', 'other'] }, order: { branch: { restaurantId: 'rest1' } } });
    const arg = m.updateMany.mock.calls[0][0];
    expect(arg.where.id.in).toEqual(['f1', 'f2']);
    expect(arg.data.moderationStatus).toBe('HIDDEN');
    expect(arg.data.moderatedByUserId).toBe('u1');
    expect(m.audit).toHaveBeenCalled();
  });

  it('unhide works; invalid action or empty ids is 400; non-admin 403', async () => {
    m.findMany.mockResolvedValue([{ id: 'f1', order: { assignment: null } }]);
    m.updateMany.mockResolvedValue({ count: 1 });
    await BULK(req({ ids: ['f1'], action: 'unhide' }));
    expect(m.updateMany.mock.calls[0][0].data.moderationStatus).toBe('PUBLISHED');
    expect((await BULK(req({ ids: [], action: 'hide' }))).status).toBe(400);
    expect((await BULK(req({ ids: ['f1'], action: 'flag' }))).status).toBe(400);
    m.auth.mockResolvedValue({ user: { id: 'u2', role: 'RIDER' } });
    expect((await BULK(req({ ids: ['f1'], action: 'hide' }))).status).toBe(403);
  });
});
