/**
 * Rider web portal — applicant status routes (/api/rider/web/application/*)
 * and the page-side portal session resolver (getRiderPortalState).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  app: null as any,
  user: null as any,
  sent: [] as any[],
  verifyOk: false,
  verified: [] as any[],
  cookie: undefined as string | undefined,
  portalUser: null as any,
  claims: null as any,
  active: true,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/otp', () => ({
  OtpRateLimitedError: class extends Error {},
  sendOtp: async (args: any) => {
    m.sent.push(args);
    return { ok: true };
  },
  verifyOtp: async (args: any) => {
    m.verified.push(args);
    return m.verifyOk;
  },
}));
vi.mock('@/server/db', () => ({
  prisma: {
    riderApplication: { findUnique: async () => m.app },
    user: { findUnique: async (q: any) => (q.where.phone ? m.user : m.portalUser) },
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (m.cookie ? { value: m.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock('@/server/rider-auth', async () => {
  const real = await vi.importActual<any>('@/server/rider-auth');
  return {
    RIDER_COOKIE: real.RIDER_COOKIE,
    riderCookieRequestAllowed: real.riderCookieRequestAllowed,
    verifyRiderToken: () => m.claims,
    riderTokenActive: async () => m.active,
  };
});

import { POST as requestOtp } from '@/app/api/rider/web/application/request-otp/route';
import { POST as verify } from '@/app/api/rider/web/application/verify/route';
import { getRiderPortalState } from '@/server/rider-portal';

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://flavrly.test/api/x', {
    method: 'POST',
    headers: { host: 'flavrly.test', origin: 'http://flavrly.test', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as any;

const PHONE = '+919876543210';

beforeEach(() => {
  m.app = null;
  m.user = null;
  m.sent = [];
  m.verified = [];
  m.verifyOk = false;
  m.cookie = undefined;
  m.portalUser = null;
  m.claims = null;
  m.active = true;
});

describe('POST /api/rider/web/application/request-otp', () => {
  it('sends a phone_verify code when an application exists and the phone is not a rider', async () => {
    m.app = { id: 'a1' };
    const r = await requestOtp(req({ phone: PHONE }));
    expect(r.status).toBe(200);
    expect(m.sent).toEqual([expect.objectContaining({ phone: PHONE, purpose: 'phone_verify' })]);
  });

  it('404s for an unknown phone and does not send', async () => {
    const r = await requestOtp(req({ phone: PHONE }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'no_application' });
    expect(m.sent).toHaveLength(0);
  });

  it('404s when the phone already belongs to a RIDER account', async () => {
    m.app = { id: 'a1' };
    m.user = { role: 'RIDER' };
    expect((await requestOtp(req({ phone: PHONE }))).status).toBe(404);
    expect(m.sent).toHaveLength(0);
  });

  it('403s cross-site requests', async () => {
    m.app = { id: 'a1' };
    expect((await requestOtp(req({ phone: PHONE }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await requestOtp(req({ phone: PHONE }, { origin: '', 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect(m.sent).toHaveLength(0);
  });
});

describe('POST /api/rider/web/application/verify', () => {
  it('401s on a wrong code', async () => {
    m.app = { status: 'PENDING', createdAt: new Date(), reviewedAt: null, rejectedReason: null };
    const r = await verify(req({ phone: PHONE, code: '000000' }));
    expect(r.status).toBe(401);
    expect(m.verified[0]).toMatchObject({ purpose: 'phone_verify' });
  });

  it('returns a status DTO (no phone, no raw row) on the right code', async () => {
    m.verifyOk = true;
    m.app = { status: 'REJECTED', createdAt: new Date('2026-10-01T00:00:00Z'), reviewedAt: new Date('2026-10-02T00:00:00Z'), rejectedReason: 'Licence unreadable', phone: PHONE, id: 'a1' };
    const r = await verify(req({ phone: PHONE, code: '123456' }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      status: 'REJECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
      reviewedAt: '2026-10-02T00:00:00.000Z',
      rejectedReason: 'Licence unreadable',
    });
  });

  it('403s cross-site requests before checking the code', async () => {
    expect((await verify(req({ phone: PHONE, code: '123456' }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect(m.verified).toHaveLength(0);
  });
});

describe('getRiderPortalState', () => {
  const claims = { userId: 'u1', sid: 's1', iat: 0, exp: Math.floor(Date.now() / 1000) + 3600, legacy: false };
  const rider = {
    id: 'u1', role: 'RIDER', name: 'Ravi', phone: PHONE, email: null, avatarUrl: null,
    suspendedAt: null, deletedAt: null, currentSessionId: 's1',
    riderProfile: { id: 'rp1', approvedAt: null, riderType: 'FLEET', dedicatedRestaurant: null },
  };

  it('signed_out without a cookie', async () => {
    expect((await getRiderPortalState()).state).toBe('signed_out');
  });
  it('expired for a bad / legacy token or a superseded session', async () => {
    m.cookie = 'tok';
    expect((await getRiderPortalState()).state).toBe('expired');
    m.claims = { ...claims, legacy: true };
    expect((await getRiderPortalState()).state).toBe('expired');
    m.claims = claims;
    m.portalUser = rider;
    m.active = false;
    expect((await getRiderPortalState()).state).toBe('expired');
  });
  it('suspended / deleted / not_rider', async () => {
    m.cookie = 'tok';
    m.claims = claims;
    m.portalUser = { ...rider, suspendedAt: new Date() };
    expect((await getRiderPortalState()).state).toBe('suspended');
    m.portalUser = { ...rider, deletedAt: new Date() };
    expect((await getRiderPortalState()).state).toBe('deleted');
    m.portalUser = null;
    expect((await getRiderPortalState()).state).toBe('deleted');
    m.portalUser = { ...rider, role: 'CUSTOMER' };
    expect((await getRiderPortalState()).state).toBe('not_rider');
  });
  it('ok with the rider summary', async () => {
    m.cookie = 'tok';
    m.claims = claims;
    m.portalUser = rider;
    const s = await getRiderPortalState();
    expect(s.state).toBe('ok');
    if (s.state === 'ok') {
      expect(s.rider).toMatchObject({ userId: 'u1', name: 'Ravi', profileId: 'rp1', riderType: 'FLEET' });
      expect(s.expiresAt).toBe(new Date(claims.exp * 1000).toISOString());
    }
  });
});
