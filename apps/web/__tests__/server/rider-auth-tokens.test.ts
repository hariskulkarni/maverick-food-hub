/** P1-11 — revocable, session-bound rider tokens; legacy tokens still verify. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const m = vi.hoisted(() => ({
  newerSessions: 0,
  current: null as null | { createdAt: Date },
  rows: {} as Record<string, { userId: string; revokedAt: Date | null }>,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/db', () => ({
  prisma: {
    userSession: {
      count: async () => m.newerSessions,
      // v2 tokens look up their own session row; legacy checks read m.current.
      findUnique: async ({ where }: { where: { id: string } }) => m.rows[where.id] ?? m.current
    }
  }
}));

import { signRiderToken, verifyRiderToken, riderTokenActive } from '@/server/rider-auth';

const SECRET = 'unit-test-nextauth-secret-0123456789abcdef';

function legacyToken(sub: string, iat: number, exp: number) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub, iat, exp, kind: 'rider' })).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  delete process.env.RIDER_TOKEN_SECRET;
  m.newerSessions = 0;
  m.current = null;
  m.rows = {};
});

describe('v2 rider tokens', () => {
  it('carry the session id, expire in 7 days and are not signed with the NextAuth secret', () => {
    const { token, expiresAt } = signRiderToken('u1', 's1');
    const c = verifyRiderToken(token)!;
    expect(c).toMatchObject({ userId: 'u1', sid: 's1', legacy: false });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThan(7.1 * 86400_000);
    const [h, p, sig] = token.split('.');
    expect(sig).not.toBe(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
  });

  it('rejects tampering and expiry', () => {
    const { token } = signRiderToken('u1', 's1');
    const [h, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', sid: 's1', iat: 1, exp: 9e9, kind: 'rider', v: 2 })).toString('base64url');
    expect(verifyRiderToken(`${h}.${forged}.${sig}`)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 86400_000);
    expect(verifyRiderToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it('is live only while its own session row exists, belongs to the rider and is unrevoked', async () => {
    const c = verifyRiderToken(signRiderToken('u1', 's1').token)!;
    expect(await riderTokenActive(c, null)).toBe(false); // no row
    m.rows.s1 = { userId: 'u1', revokedAt: null };
    expect(await riderTokenActive(c, null)).toBe(true);
    // currentSessionId pointing elsewhere (e.g. a web or NextAuth login) is irrelevant for v2.
    expect(await riderTokenActive(c, 's2')).toBe(true);
    m.rows.s1 = { userId: 'someone-else', revokedAt: null };
    expect(await riderTokenActive(c, null)).toBe(false);
    m.rows.s1 = { userId: 'u1', revokedAt: new Date() }; // logout / superseded / admin sign-out
    expect(await riderTokenActive(c, null)).toBe(false);
  });
});

describe('legacy (pre-session) tokens from installed builds', () => {
  const now = Math.floor(Date.now() / 1000);
  it('still verify until their own expiry', () => {
    expect(verifyRiderToken(legacyToken('u1', now - 100, now + 1000))).toMatchObject({ userId: 'u1', sid: null, legacy: true });
    expect(verifyRiderToken(legacyToken('u1', now - 100, now - 1))).toBeNull();
  });
  it('are revoked by any later login/logout or a current-session pointer newer than the token', async () => {
    const c = verifyRiderToken(legacyToken('u1', now - 100, now + 1000))!;
    expect(await riderTokenActive(c, null)).toBe(true);
    m.newerSessions = 1;
    expect(await riderTokenActive(c, null)).toBe(false);
    m.newerSessions = 0;
    m.current = { createdAt: new Date() };
    expect(await riderTokenActive(c, 'sx')).toBe(false);
    m.current = { createdAt: new Date((now - 1000) * 1000) };
    expect(await riderTokenActive(c, 'sx')).toBe(true);
  });
});
