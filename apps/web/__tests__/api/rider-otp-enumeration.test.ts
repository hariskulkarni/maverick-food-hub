/**
 * Lead item 8: /api/rider/auth/request-otp must not reveal whether a phone is a
 * registered rider (the old 404 not_a_rider enabled phone enumeration). A
 * non-rider gets the same 200 shape and no code is sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, sendOtp } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  sendOtp: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/otp', () => ({ sendOtp, OtpRateLimitedError: class extends Error {} }));

import { POST } from '@/app/api/rider/auth/request-otp/route';
const call = (phone: string) => POST(new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }) as any);

beforeEach(() => { vi.clearAllMocks(); });

describe('rider request-otp', () => {
  it('rider: code sent, 200', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'RIDER' });
    const r = await call('+919876500001');
    expect(r.status).toBe(200);
    expect(sendOtp).toHaveBeenCalled();
  });
  it('unknown phone and non-rider: identical 200 { ok: true }, nothing sent', async () => {
    for (const u of [null, { role: 'CUSTOMER' }, { role: 'ADMIN' }]) {
      db.user.findUnique.mockResolvedValue(u);
      const r = await call('+919876500002');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    }
    expect(sendOtp).not.toHaveBeenCalled();
  });
});
