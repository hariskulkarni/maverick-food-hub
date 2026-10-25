/**
 * Merge reconciliation: super-admin "Sign out everywhere" must revoke EVERY
 * rider token — v2 tokens (their UserSession row is revoked; riders may hold an
 * app AND a web-portal session at once) and legacy pre-sid tokens
 * (rejected only when currentSessionId points at a session newer than the
 * token). Uses the real rider-auth riderTokenActive against an in-memory store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

type Sess = { id: string; userId: string; createdAt: Date; revokedAt: Date | null; revokedReason?: string | null };
const store = vi.hoisted(() => ({ sessions: [] as any[], user: {} as any, n: 0 }));
const db = vi.hoisted(() => {
  const d: any = {
    user: {
      findUnique: vi.fn(async () => store.user),
      update: vi.fn(async ({ data }: any) => Object.assign(store.user, data)),
    },
    userSession: {
      findUnique: vi.fn(async ({ where }: any) => store.sessions.find((s: any) => s.id === where.id) ?? null),
      count: vi.fn(async ({ where }: any) =>
        store.sessions.filter(
          (s: any) => s.userId === where.userId && s.createdAt > where.createdAt.gt && (!where.OR || s.client !== 'rider-web'),
        ).length),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let c = 0;
        for (const s of store.sessions) if (s.userId === where.userId && s.revokedAt === null && (where.client === undefined || s.client === where.client)) { Object.assign(s, data); c++; }
        return { count: c };
      }),
      create: vi.fn(async ({ data }: any) => { const s = { id: `s${++store.n}`, createdAt: new Date(), revokedAt: null, ...data }; store.sessions.push(s); return s; }),
    },
  };
  d.$transaction = vi.fn(async (fn: any) => fn(d));
  return d;
});
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/2fa', () => ({ recordLoginSuccess: vi.fn() }));

import { signRiderToken, verifyRiderToken, riderTokenActive } from '@/server/rider-auth';
import { adminSignOut } from '@/server/platform-user-admin';
import { startRiderSession } from '@/server/sessions';

const SECRET = 'test-nextauth-secret-0123456789abcdef';
function legacyToken(userId: string): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: userId, iat: now, exp: now + 30 * 86400, kind: 'rider' })}`;
  return `${head}.${crypto.createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}
async function live(token: string): Promise<boolean> {
  const claims = verifyRiderToken(token);
  if (!claims) return false;
  return riderTokenActive(claims, store.user.currentSessionId ?? null);
}

const T0 = Date.UTC(2026, 9, 25, 6, 0, 0);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv('NEXTAUTH_SECRET', SECRET);
  store.sessions.length = 0;
  store.n = 0;
  // Rider with a current session started before any token below.
  store.sessions.push({ id: 'sess-login', userId: 'r1', createdAt: new Date(T0 - 60_000), revokedAt: null } as Sess);
  store.user = { id: 'r1', role: 'RIDER', deletedAt: null, suspendedAt: null, currentSessionId: 'sess-login' };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const actor = { id: 'su1', role: 'SUPER_ADMIN' };

describe('sign out everywhere revokes rider tokens', () => {
  it('a v2 token issued before sign-out is rejected after it', async () => {
    const { token } = signRiderToken('r1', 'sess-login');
    expect(await live(token)).toBe(true);
    vi.setSystemTime(T0 + 5_000);
    expect((await adminSignOut(actor, 'r1')).ok).toBe(true);
    expect(await live(token)).toBe(false);
  });

  it('a legacy (pre-sid) token issued before sign-out is rejected after it', async () => {
    const token = legacyToken('r1');
    expect(await live(token)).toBe(true); // control: valid before
    vi.setSystemTime(T0 + 5_000);
    expect((await adminSignOut(actor, 'r1')).ok).toBe(true);
    expect(store.user.currentSessionId).not.toBeNull();
    expect(await live(token)).toBe(false);
  });

  it('all live sessions are revoked and the marker is not an active session', async () => {
    vi.setSystemTime(T0 + 5_000);
    await adminSignOut(actor, 'r1');
    expect(store.sessions.every((s: any) => s.revokedAt instanceof Date)).toBe(true);
    const marker = store.sessions.find((s: any) => s.id === store.user.currentSessionId);
    expect(marker.revokedReason).toBe('admin_signout');
  });

  it('kills a rider app session AND a web-portal session held at the same time', async () => {
    const appSid = (await startRiderSession('r1', 'rider-app'))!;
    const webSid = (await startRiderSession('r1', 'rider-web'))!;
    const app = signRiderToken('r1', appSid).token;
    const web = signRiderToken('r1', webSid).token;
    expect(await live(app)).toBe(true);
    expect(await live(web)).toBe(true);
    vi.setSystemTime(T0 + 5_000);
    await adminSignOut(actor, 'r1');
    expect(await live(app)).toBe(false);
    expect(await live(web)).toBe(false);
  });

  it('a legacy app token survives a web-portal login but not a new app login', async () => {
    const token = legacyToken('r1');
    vi.setSystemTime(T0 + 1_000);
    await startRiderSession('r1', 'rider-web');
    expect(await live(token)).toBe(true);
    vi.setSystemTime(T0 + 2_000);
    await startRiderSession('r1', 'rider-app');
    expect(await live(token)).toBe(false);
  });
});
