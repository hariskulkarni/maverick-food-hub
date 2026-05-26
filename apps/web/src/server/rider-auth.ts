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
 * Token lifetime is 30 days. The signing secret is NEXTAUTH_SECRET (already in
 * .env) — no extra env var to manage.
 */
import crypto from 'node:crypto';
import { headers } from 'next/headers';
import { auth as sessionAuth } from './auth';
import { prisma } from './db';
import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is required to sign rider tokens');
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Sign a rider JWT (HS256). The payload carries only the userId — the role is
 * re-checked against the database on every request, so a token can't outlive
 * a rider being deactivated.
 */
export function signRiderToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS, kind: 'rider' })
  );
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Verify a rider JWT. Returns the userId, or null if invalid / expired / tampered. */
export function verifyRiderToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;

  const expected = crypto
    .createHmac('sha256', secret())
    .update(`${header}.${payload}`)
    .digest('base64url');

  // timingSafeEqual throws on length mismatch — guard before comparing.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let claims: { sub?: unknown; exp?: unknown; kind?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.kind !== 'rider') return null;
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  return claims.sub;
}

/**
 * Drop-in replacement for NextAuth's `auth()`, for use in `/api/rider/*` route
 * handlers. Returns the same `Session` shape so the route code below it never
 * changes — only the import line does.
 *
 *   Bearer token present + valid + user is a RIDER → synthesized rider session
 *   Bearer token present but bad/expired           → null (clean 403, no fallback)
 *   no Bearer header                               → NextAuth cookie session
 */
export async function auth(): Promise<Session | null> {
  const h = await headers();
  const authz = h.get('authorization') ?? h.get('Authorization');

  if (authz && authz.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    const userId = verifyRiderToken(token);
    if (userId) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, name: true, email: true, phone: true, suspendedAt: true }
      });
      // Suspended riders are locked out immediately: a super-admin suspension
      // (User.suspendedAt) invalidates every existing token on the next request,
      // not just future logins. role/suspension are re-checked here on EVERY
      // request, so a token can't outlive a rider being deactivated or blocked.
      if (u && u.role === Role.RIDER && !u.suspendedAt) {
        return {
          user: {
            id: u.id,
            role: u.role,
            name: u.name ?? null,
            email: u.email ?? null,
            phone: u.phone ?? null,
            branchId: null
          }
        } as Session;
      }
    }
    // An explicit Bearer attempt that doesn't check out fails cleanly — we do
    // NOT fall back to cookies, so a stale token returns 403 instead of
    // silently picking up some unrelated browser session.
    return null;
  }

  // No Bearer header → ordinary web PWA request → use the NextAuth cookie session.
  return sessionAuth();
}
