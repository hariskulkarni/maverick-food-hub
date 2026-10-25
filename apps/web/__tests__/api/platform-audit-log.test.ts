/**
 * F13 — audit-log search: q also matches the actor's email / name / phone;
 * invalid from/to → 400 (not a 500). Non-super-admin → 403 JSON (not a thrown
 * Response that Next turns into a 500).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
const db = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));

import { GET } from '@/app/api/platform/audit-log/route';

const get = (qs: string) => GET(new Request(`http://x/api/platform/audit-log?${qs}`) as any);

beforeEach(() => {
  vi.clearAllMocks();
  session = { user: { id: 'su1', role: 'SUPER_ADMIN' } };
  db.auditLog.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
});

describe('GET /api/platform/audit-log', () => {
  it('non-super-admin -> 403 (not 500)', async () => {
    session = { user: { id: 'a1', role: 'ADMIN' } };
    const r = await get('');
    expect(r.status).toBe(403);
  });
  it('no session -> 401', async () => {
    session = null;
    expect((await get('')).status).toBe(401);
  });
  it('invalid from/to -> 400', async () => {
    expect((await get('from=not-a-date')).status).toBe(400);
    expect((await get('to=2026-13-45')).status).toBe(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
  it('q matches actors by email / name / phone', async () => {
    db.user.findMany.mockResolvedValueOnce([{ id: 'u7' }, { id: 'u8' }]);
    const r = await get('q=ravi%40x.com');
    expect(r.status).toBe(200);
    const userQ = db.user.findMany.mock.calls[0][0];
    expect(JSON.stringify(userQ.where)).toContain('email');
    expect(JSON.stringify(userQ.where)).toContain('phone');
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([{ actorId: { in: ['u7', 'u8'] } }]));
  });
});
