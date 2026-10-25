/**
 * Rider web portal — cookie transport for the rider token (rider-auth) and the
 * thin /api/rider/web/session* routes that set / refresh / clear the cookie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sess = { id: string; userId: string; client: string | null; createdAt: Date; revokedAt: Date | null; revokedReason?: string | null };
const m = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
  user: null as null | Record<string, unknown>,
  profile: null as null | Record<string, unknown>,
  sessions: [] as Sess[],
  n: 0,
  profileUpdates: [] as unknown[],
}));

vi.mock('next/headers', () => ({
  headers: async () => m.headers,
  cookies: async () => ({ get: (k: string) => (m.cookies.has(k) ? { name: k, value: m.cookies.get(k)! } : undefined) }),
}));
vi.mock('@/server/auth', () => ({ auth: async () => ({ user: { id: 'nextauth-user', role: 'CUSTOMER' } }) }));
vi.mock('@/server/db', () => {
  const matches = (s: Sess, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (s as Record<string, unknown>)[k] === v);
  const prisma: Record<string, any> = {
    user: { findUnique: async () => m.user, updateMany: async () => ({ count: 0 }) },
    userSession: {
      findUnique: async ({ where }: any) => m.sessions.find((s) => s.id === where.id) ?? null,
      count: async () => 0,
      create: async ({ data }: any) => {
        const s = { id: `sess${++m.n}`, client: null, createdAt: new Date(), revokedAt: null, ...data };
        m.sessions.push(s);
        return s;
      },
      update: async ({ where, data }: any) => Object.assign(m.sessions.find((s) => s.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => {
        const hit = m.sessions.filter((s) => matches(s, where));
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
    },
    riderProfile: {
      findUnique: async () => m.profile,
      updateMany: async (args: unknown) => { m.profileUpdates.push(args); return { count: 1 }; },
    },
    riderHeartbeat: { findUnique: async () => ({ lastSeenAt: new Date('2026-10-25T10:00:00Z') }) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma };
});
vi.mock('@/server/audit', () => ({ audit: async () => {} }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/server/otp', () => ({
  verifyOtp: async ({ code }: { code: string }) => code === '123456',
  sendOtp: async () => ({ ok: true }),
  OtpRateLimitedError: class extends Error {},
}));

import { NextRequest } from 'next/server';
import { auth, readRiderBearer, signRiderToken, RIDER_COOKIE, riderCookieRequestAllowed } from '@/server/rider-auth';
import { POST as webLogin } from '@/app/api/rider/web/session/route';
import { POST as webRefresh } from '@/app/api/rider/web/session/refresh/route';
import { POST as webLogout } from '@/app/api/rider/web/session/logout/route';
import { POST as appLogin } from '@/app/api/rider/auth/verify-otp/route';
import { POST as appLogout } from '@/app/api/rider/auth/logout/route';
import { GET as riderMe } from '@/app/api/rider/me/route';

const HOST = 'flavrly.in';

function rider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1', role: 'RIDER', name: 'Ravi', email: null, phone: '+919000000001',
    suspendedAt: null, deletedAt: null, currentSessionId: 's1', ...overrides,
  };
}
function setReq(h: Record<string, string>) {
  m.headers = new Headers({ host: HOST, ...h });
}
function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const headers = new Headers({ host: HOST, 'content-type': 'application/json', ...(init.headers ?? {}) });
  m.headers = headers;
  return new NextRequest(`https://${HOST}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret-0123456789abcdef';
  m.cookies.clear();
  m.user = rider();
  m.profile = null;
  m.sessions = [];
  m.n = 0;
  m.profileUpdates = [];
  // A live session row 's1' (as created by a login) for the default rider.
  m.sessions.push({ id: 's1', userId: 'r1', client: 'rider-web', createdAt: new Date(), revokedAt: null });
  setReq({});
});

describe('riderCookieRequestAllowed (CSRF rule for cookie-carried tokens)', () => {
  it('allows same-origin and header-less requests, blocks cross-site and foreign origins', () => {
    const h = (o: Record<string, string>) => new Headers({ host: HOST, ...o });
    expect(riderCookieRequestAllowed(h({}))).toBe(true);
    expect(riderCookieRequestAllowed(h({ origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(riderCookieRequestAllowed(h({ 'sec-fetch-site': 'none' }))).toBe(true);
    expect(riderCookieRequestAllowed(h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(riderCookieRequestAllowed(h({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(riderCookieRequestAllowed(h({ origin: 'https://evil.example' }))).toBe(false);
    expect(riderCookieRequestAllowed(h({ origin: 'null' }))).toBe(false);
  });
});

describe('rider-auth cookie transport', () => {
  it('accepts a live v2 token from the portal cookie and returns the rider session', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    setReq({ origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' });
    const b = await readRiderBearer();
    expect(b.kind).toBe('valid');
    expect(b.kind === 'valid' && b.transport).toBe('cookie');
    expect((await auth())?.user).toMatchObject({ id: 'r1', role: 'RIDER' });
  });

  it('rejects a cross-site cookie request without falling back to the NextAuth session', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    setReq({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect((await readRiderBearer()).kind).toBe('invalid');
    expect(await auth()).toBeNull();
  });

  it('honours revocation, suspension and deletion exactly like the Bearer path', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    m.sessions[0].revokedAt = new Date(); // logged out / superseded / signed out everywhere
    expect((await readRiderBearer()).kind).toBe('invalid');
    m.sessions[0].revokedAt = null;
    m.user = rider({ suspendedAt: new Date() });
    expect((await readRiderBearer()).kind).toBe('invalid');
    m.user = rider({ deletedAt: new Date() });
    expect((await readRiderBearer()).kind).toBe('invalid');
    m.user = rider({ role: 'CUSTOMER' });
    expect((await readRiderBearer()).kind).toBe('invalid');
  });

  it('prefers an Authorization Bearer header over the cookie', async () => {
    m.cookies.set(RIDER_COOKIE, 'garbage');
    setReq({ authorization: `Bearer ${signRiderToken('r1', 's1').token}` });
    const b = await readRiderBearer();
    expect(b.kind === 'valid' && b.transport).toBe('bearer');
  });

  it('with no token at all falls through to the NextAuth session (unchanged behaviour)', async () => {
    expect((await readRiderBearer()).kind).toBe('none');
    expect((await auth())?.user.id).toBe('nextauth-user');
  });

  it('the portal reuses the same /api/rider/* routes: GET /api/rider/me works with the cookie', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    m.profile = { id: 'p1', isOnline: true, riderType: 'FLEET', dedicatedRestaurant: null, user: { avatarUrl: null } };
    setReq({ 'sec-fetch-site': 'same-origin' });
    const res = await riderMe();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ online: true, riderType: 'FLEET' });
    // …and a dead cookie gets the app's 401 session_expired.
    m.sessions[0].revokedAt = new Date();
    expect((await riderMe()).status).toBe(401);
  });
});

describe('/api/rider/web/session routes', () => {
  it('login sets an httpOnly SameSite=Lax cookie and never returns the token to JS', async () => {
    m.user = { id: 'r1', name: 'Ravi', phone: '+919000000001', role: 'RIDER', suspendedAt: null, deletedAt: null };
    const res = await webLogin(req('/api/rider/web/session', { body: { phone: '+919000000001', code: '123456' }, headers: { origin: `https://${HOST}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeUndefined();
    expect(body.rider).toMatchObject({ id: 'r1' });
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${RIDER_COOKIE}=`);
    expect(set.toLowerCase()).toContain('httponly');
    expect(set.toLowerCase()).toContain('samesite=lax');
    expect(set).toContain('Path=/');
  });

  it('login passes verify-otp errors through (wrong code, suspended) and sets no cookie', async () => {
    m.user = { id: 'r1', name: 'Ravi', phone: '+919000000001', role: 'RIDER', suspendedAt: null, deletedAt: null };
    const bad = await webLogin(req('/api/rider/web/session', { body: { phone: '+919000000001', code: '000000' } }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie')).toBeNull();
    m.user = { ...m.user, suspendedAt: new Date() };
    const sus = await webLogin(req('/api/rider/web/session', { body: { phone: '+919000000001', code: '123456' } }));
    expect(sus.status).toBe(403);
    expect((await sus.json()).error).toBe('suspended');
  });

  it('login rejects cross-origin (login CSRF)', async () => {
    const res = await webLogin(req('/api/rider/web/session', { body: { phone: '+919000000001', code: '123456' }, headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });

  it('refresh re-issues the cookie for a live session and clears it once revoked', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    const ok = await webRefresh(req('/api/rider/web/session/refresh', { headers: { origin: `https://${HOST}` } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain(`${RIDER_COOKIE}=ey`);
    m.sessions[0].revokedAt = new Date();
    const dead = await webRefresh(req('/api/rider/web/session/refresh', { headers: { origin: `https://${HOST}` } }));
    expect(dead.status).toBe(401);
    expect(dead.headers.get('set-cookie')).toMatch(new RegExp(`${RIDER_COOKIE}=;`));
  });

  it('logout revokes the server session (existing logout) and expires the cookie', async () => {
    m.cookies.set(RIDER_COOKIE, signRiderToken('r1', 's1').token);
    setReq({ origin: `https://${HOST}` });
    const res = await webLogout();
    expect(res.status).toBe(200);
    expect(m.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${RIDER_COOKIE}=;`));
  });
});

describe('rider multi-session: app and web portal coexist', () => {
  const riderRow = () => ({ id: 'r1', name: 'Ravi', phone: '+919000000001', role: 'RIDER', suspendedAt: null, deletedAt: null, email: null, currentSessionId: null });
  const live = async (token: string, h: Record<string, string>) => {
    setReq(h);
    return (await readRiderBearer()).kind === 'valid';
  };
  async function loginApp(): Promise<string> {
    const res = await appLogin(req('/api/rider/auth/verify-otp', { body: { phone: '+919000000001', code: '123456' } }));
    expect(res.status).toBe(200);
    return (await res.json()).token;
  }
  async function loginWeb(): Promise<string> {
    const res = await webLogin(req('/api/rider/web/session', { body: { phone: '+919000000001', code: '123456' }, headers: { origin: `https://${HOST}` } }));
    expect(res.status).toBe(200);
    return /flavrly_rider_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1];
  }
  const asApp = (t: string) => ({ authorization: `Bearer ${t}` });
  const asWeb = (t: string) => { m.cookies.set(RIDER_COOKIE, t); return { 'sec-fetch-site': 'same-origin' }; };

  beforeEach(() => {
    m.sessions = [];
    m.user = riderRow();
  });

  it('signing in on the web does not sign the app out (and vice versa)', async () => {
    const app = await loginApp();
    const web = await loginWeb();
    expect(m.sessions.map((s) => s.client)).toEqual(['rider-app', 'rider-web']);
    expect(await live(app, asApp(app))).toBe(true);
    m.cookies.clear();
    expect(await live(web, asWeb(web))).toBe(true);
  });

  it('web logout revokes only the web session and never takes the rider offline', async () => {
    const app = await loginApp();
    const web = await loginWeb();
    asWeb(web);
    setReq({ origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' });
    await webLogout();
    m.cookies.clear();
    expect(await live(app, asApp(app))).toBe(true);
    expect(await live(web, asWeb(web))).toBe(false);
    expect(m.profileUpdates).toHaveLength(0); // isOnline / push token untouched
  });

  it('app logout revokes only the app session', async () => {
    const app = await loginApp();
    const web = await loginWeb();
    m.cookies.clear();
    setReq(asApp(app));
    await appLogout();
    expect(m.profileUpdates).toHaveLength(1); // app sign-out goes offline + drops push token
    expect(await live(app, asApp(app))).toBe(false);
    expect(await live(web, asWeb(web))).toBe(true);
  });

  it('a new app login supersedes the older app session (one phone) but not the web session', async () => {
    const app1 = await loginApp();
    const web = await loginWeb();
    const app2 = await loginApp();
    m.cookies.clear();
    expect(await live(app1, asApp(app1))).toBe(false);
    expect(await live(app2, asApp(app2))).toBe(true);
    expect(await live(web, asWeb(web))).toBe(true);
  });

  it('suspension kills both surfaces', async () => {
    const app = await loginApp();
    const web = await loginWeb();
    m.user = { ...riderRow(), suspendedAt: new Date() };
    m.cookies.clear();
    expect(await live(app, asApp(app))).toBe(false);
    expect(await live(web, asWeb(web))).toBe(false);
  });
});
