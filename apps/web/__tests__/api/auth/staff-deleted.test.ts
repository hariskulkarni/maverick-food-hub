import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, verify, start, confirm } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  verify: vi.fn(async () => true),
  start: vi.fn(async () => ({ qr: 'q', secret: 's', otpauth: 'o' })),
  confirm: vi.fn(async () => true),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('argon2', () => ({ default: { verify } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 1 }) }));
vi.mock('@/server/2fa', () => ({ isLockedOut: () => false, recordLoginFailure: vi.fn(), getPlatformSecurity: async () => ({}) }));
vi.mock('@/server/user-totp', () => ({
  isStaffTotpRole: () => true,
  isTotpEnrolled: () => false,
  startEnrollment: start,
  confirmEnrollment: confirm,
}));

import { POST as precheck } from '@/app/api/auth/staff/precheck/route';
import { POST as enroll } from '@/app/api/auth/staff/enroll/route';

const mk = (body: unknown) =>
  new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const base = { id: 'u1', email: 'a@x.com', passwordHash: 'h', role: 'ADMIN', suspendedAt: null, deletedAt: null };

beforeEach(() => { vi.clearAllMocks(); verify.mockResolvedValue(true); });

describe('staff gate rejects soft-deleted accounts', () => {
  it('precheck: active user starts enrollment (control)', async () => {
    db.user.findUnique.mockResolvedValue(base);
    const j = await (await precheck(mk({ email: 'a@x.com', password: 'p' }))).json();
    expect(j.status).toBe('enroll');
  });
  it('precheck: deleted user -> ok:false, no enrollment', async () => {
    db.user.findUnique.mockResolvedValue({ ...base, deletedAt: new Date() });
    expect(await (await precheck(mk({ email: 'a@x.com', password: 'p' }))).json()).toEqual({ ok: false });
    expect(start).not.toHaveBeenCalled();
  });
  it('enroll: deleted user -> ok:false, no confirmation', async () => {
    db.user.findUnique.mockResolvedValue({ ...base, deletedAt: new Date() });
    expect(await (await enroll(mk({ email: 'a@x.com', password: 'p', code: '123456' }))).json()).toEqual({ ok: false });
    expect(confirm).not.toHaveBeenCalled();
  });
});
