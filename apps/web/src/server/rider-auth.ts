/**
 * Rider token auth — bridges the native rider app (Bearer JWT) into the same
 * auth surface the web rider PWA already uses (NextAuth session cookies).
 *
 * The native React Native app has no cookie jar, so it authenticates with a
 * signed JWT in the `Authorization: Bearer <token>` header. This module:
 *
 *   - signs / verifies those tokens — HS256 via Node's crypto, so there's no
 *     new npm dependency and nothing for the bundler to choke on.
 *   - exports a drop-in `auth()` that `/api/rider/*` route handlers import
 *     INSTEAD of the one from `@/server/auth`. It checks the Bearer token
 *     first; if there isn't one it falls back to the NextAuth cookie session,
 *     so the existing web rider PWA keeps working completely unchanged.
 *
 * Token lifetime / revocation: see the P1-11 block below.
 */
import crypto from 'node:crypto';
import { headers, cookies } from 'next/headers';
import { auth as sessionAuth } from './auth';
import { prisma } from './db';
import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

/**
 * P1-11 (2026-10-25) — revocable rider tokens.
 *
 * v2 tokens: `{ sub, sid, iat, exp, kind:'rider', v:2 }`, 7-day TTL, signed
 * with a rider-specific key (RIDER_TOKEN_SECRET, else a key DERIVED from
 * NEXTAUTH_SECRET — never the NextAuth secret itself). `sid` is a UserSession
 * id: the token is honoured only while that row is unrevoked (see
 * riderTokenActive — multi-session: one app + one web-portal session), so
 * logout, a newer login on the same surface, or a super-admin sign-out /
 * suspension / reset kills it on the next request. The app slides the expiry
 * forward via POST /api/rider/auth/refresh.
 *
 * Legacy tokens (30-day, no sid, signed with NEXTAUTH_SECRET) from builds
 * already installed keep working until they expire, EXCEPT once the rider
 * has logged in again on the app or logged out (any non-web UserSession
 * created after the token's iat) or been signed out everywhere — so they are
 * revocable too. Old builds have no refresh; when
 * their token stops validating, /api/rider/me answers 401 and the existing
 * app signs out to the login screen (clean re-login). New builds call refresh,
 * which upgrades a legacy token to v2.
 */
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days (v2)

function legacySecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is required to verify rider tokens');
  return s;
}

function v2Secret(): string {
  const explicit = process.env.RIDER_TOKEN_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  return crypto.createHmac('sha256', legacySecret()).update('flavrly:rider-token:v2').digest('hex');
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(key: string, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

function sigOk(sig: string, expected: string): boolean {
  // timingSafeEqual throws on length mismatch — guard before comparing.
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Sign a v2 rider JWT (HS256) bound to session `sid`. */
export function signRiderToken(userId: string, sid: string): { token: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, sid, iat: now, exp, kind: 'rider', v: 2 }));
  const sig = hmac(v2Secret(), `${header}.${payload}`);
  return { token: `${header}.${payload}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export interface RiderTokenClaims {
  userId: string;
  /** UserSession id (v2), or null for a legacy token. */
  sid: string | null;
  iat: number;
  exp: number;
  legacy: boolean;
}

/** Verify a rider JWT's signature + expiry. Does NOT check revocation (see riderTokenActive). */
export function verifyRiderToken(token: string): RiderTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;

  let legacy: boolean;
  if (sigOk(sig, hmac(v2Secret(), `${header}.${payload}`))) legacy = false;
  else if (sigOk(sig, hmac(legacySecret(), `${header}.${payload}`))) legacy = true;
  else return null;

  let claims: { sub?: unknown; exp?: unknown; iat?: unknown; kind?: unknown; sid?: unknown; v?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.kind !== 'rider') return null;
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  const iat = typeof claims.iat === 'number' ? claims.iat : 0;
  if (!legacy) {
    if (claims.v !== 2 || typeof claims.sid !== 'string' || !claims.sid) return null;
    return { userId: claims.sub, sid: claims.sid, iat, exp: claims.exp, legacy };
  }
  return { userId: claims.sub, sid: null, iat, exp: claims.exp, legacy };
}

/**
 * Is a signature-valid token still live?
 *
 * v2 (multi-session, 2026-10-25): the token's sid must be a UserSession row of
 * THIS user that has not been revoked. Riders can therefore hold an app session
 * and a web-portal session at once; logout revokes only its own row; a new app
 * login supersedes only older app rows; super-admin "sign out everywhere",
 * suspension and password reset revoke every live row.
 *
 * Legacy (pre-sid, app-only): dead once the user's currentSessionId points at a
 * session newer than the token (the super-admin sign-out marker) or once any
 * non-web session (an app login / app logout marker / NextAuth login) started
 * after it was issued. Web-portal logins do NOT kill legacy app tokens.
 * `currentSessionId` is only consulted for legacy tokens.
 */
export async function riderTokenActive(claims: RiderTokenClaims, currentSessionId: string | null): Promise<boolean> {
  if (!claims.legacy) {
    if (!claims.sid) return false;
    const row = await prisma.userSession.findUnique({ where: { id: claims.sid }, select: { userId: true, revokedAt: true } });
    return !!row && row.userId === claims.userId && row.revokedAt === null;
  }
  if (currentSessionId) {
    const cur = await prisma.userSession.findUnique({ where: { id: currentSessionId }, select: { createdAt: true } });
    if (!cur || cur.createdAt.getTime() > claims.iat * 1000) return false;
  }
  const newer = await prisma.userSession.count({
    where: {
      userId: claims.userId,
      createdAt: { gt: new Date(claims.iat * 1000) },
      OR: [{ client: null }, { client: { not: 'rider-web' } }],
    },
  });
  return newer === 0;
}

/**
 * Rider web portal (/rider) transport — 2026-10-25.
 *
 * The browser portal holds the SAME v2 rider token in an httpOnly, Secure,
 * SameSite=Lax cookie (set only by /api/rider/web/session*, never readable by
 * JS). It is an alternative transport for the exact same token, so every
 * /api/rider/* route, revocation (session row), suspension and
 * deletion check applies unchanged. Precedence: Bearer header > rider cookie >
 * NextAuth session.
 *
 * CSRF: a cookie-carried token is honoured only for same-origin requests —
 * `Sec-Fetch-Site` must be absent / same-origin / none and any `Origin` must
 * match `Host`. Combined with SameSite=Lax and the middleware csrfGuard (which
 * rejects mismatched-Origin mutations on every /api route) a third-party page
 * cannot drive a rider mutation with the cookie.
 */
export const RIDER_COOKIE = 'flavrly_rider_session';

/** Same-origin test for cookie-authenticated rider API requests (see above). */
export function riderCookieRequestAllowed(h: { get(name: string): string | null }): boolean {
  const site = h.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = h.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== h.get('host')) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Cookie attributes for the rider portal session cookie. */
export function riderCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export type RiderBearer =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | {
      kind: 'valid';
      claims: RiderTokenClaims;
      transport: 'bearer' | 'cookie';
      user: { id: string; role: Role; name: string | null; email: string | null; phone: string | null };
    };

/**
 * Resolve the request's rider token — `Authorization: Bearer` (native app) or
 * the rider portal cookie — including revocation + account checks.
 */
export async function readRiderBearer(): Promise<RiderBearer> {
  const h = await headers();
  const authz = h.get('authorization') ?? h.get('Authorization');
  let raw: string | null = null;
  let transport: 'bearer' | 'cookie' = 'bearer';
  if (authz && authz.startsWith('Bearer ')) {
    raw = authz.slice(7).trim();
  } else {
    const c = (await cookies()).get(RIDER_COOKIE)?.value;
    if (!c) return { kind: 'none' };
    if (!riderCookieRequestAllowed(h)) return { kind: 'invalid' };
    raw = c;
    transport = 'cookie';
  }
  const claims = verifyRiderToken(raw);
  if (!claims) return { kind: 'invalid' };
  // The portal cookie only ever carries v2 (session-bound) tokens.
  if (transport === 'cookie' && claims.legacy) return { kind: 'invalid' };
  const u = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, role: true, name: true, email: true, phone: true, suspendedAt: true, deletedAt: true, currentSessionId: true },
  });
  // role / suspension / deletion are re-checked on EVERY request, so a token
  // can't outlive a rider being deactivated, blocked or deleted.
  if (!u || u.role !== Role.RIDER || u.suspendedAt || u.deletedAt) return { kind: 'invalid' };
  if (!(await riderTokenActive(claims, u.currentSessionId))) return { kind: 'invalid' };
  return { kind: 'valid', claims, transport, user: { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone } };
}

/**
 * Drop-in replacement for NextAuth's `auth()`, for use in `/api/rider/*` route
 * handlers. Returns the same `Session` shape so the route code below it never
 * changes — only the import line does.
 *
 *   Bearer token / rider portal cookie valid + live + active RIDER → rider session
 *   Bearer token / rider cookie present but bad/expired/revoked/
 *     cross-site (cookie)                                         → null (clean 403, no fallback)
 *   neither                                                       → NextAuth cookie session
 */
export async function auth(): Promise<Session | null> {
  const bearer = await readRiderBearer();
  if (bearer.kind === 'valid') {
    const u = bearer.user;
    return {
      user: { id: u.id, role: u.role, name: u.name ?? null, email: u.email ?? null, phone: u.phone ?? null, branchId: null }
    } as Session;
  }
  // An explicit Bearer attempt that doesn't check out fails cleanly — we do
  // NOT fall back to cookies, so a stale token returns 403 instead of
  // silently picking up some unrelated browser session.
  if (bearer.kind === 'invalid') return null;
  // No rider token at all → fall back to the NextAuth cookie session.
  return sessionAuth();
}

/** 401 body the native app recognises as "sign in again". */
export function sessionExpiredResponse(): Response {
  return Response.json(
    { error: 'session_expired', message: 'Your session has ended. Please sign in again.' },
    { status: 401 }
  );
}
