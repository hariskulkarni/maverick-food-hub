/**
 * The ONLY gate for the Observability Center. Every /api/platform/observability/**
 * route and the /platform/observability page call it server-side.
 *
 * Requirements (all must hold):
 *   1. a live session (401 otherwise);
 *   2. role === SUPER_ADMIN — no capability delegation, so ADMIN_ASSIST /
 *      DEVELOPER / QA / GUEST / ADMIN / KITCHEN / RIDER / CUSTOMER are refused;
 *   3. a 2FA session: the user has Google Authenticator enrolled, is not a
 *      break-glass account (those log in single-factor), and the CURRENT
 *      session (User.currentSessionId) was started at/after TOTP enrolment —
 *      i.e. this login actually presented a TOTP code.
 */
import { Role } from '@prisma/client';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { unauthenticated, forbidden } from '@/server/api-auth';
import { isBreakGlassEmail } from '@/server/user-totp';

export type ObsDenyReason = 'unauthenticated' | 'role' | '2fa';

export interface ObsSession {
  userId: string;
  email: string | null;
  name: string | null;
}

/** Pure decision, unit-tested. */
export function decideObservabilityAccess(input: {
  role: string | null | undefined;
  email: string | null | undefined;
  totpEnabledAt: Date | null | undefined;
  sessionStartedAt: Date | null | undefined;
}): ObsDenyReason | null {
  if (!input.role) return 'unauthenticated';
  if (input.role !== Role.SUPER_ADMIN) return 'role';
  if (!input.totpEnabledAt) return '2fa';
  if (isBreakGlassEmail(input.email)) return '2fa';
  if (!input.sessionStartedAt || input.sessionStartedAt.getTime() < input.totpEnabledAt.getTime()) return '2fa';
  return null;
}

async function evaluate(): Promise<{ ok: ObsSession } | { deny: ObsDenyReason }> {
  const session = await auth();
  const uid = session?.user?.id;
  if (!session?.user || !uid) return { deny: 'unauthenticated' };
  if (session.user.role !== Role.SUPER_ADMIN) return { deny: 'role' };
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true, name: true, role: true, totpEnabledAt: true, currentSessionId: true },
  });
  let sessionStartedAt: Date | null = null;
  if (user?.currentSessionId) {
    const s = await prisma.userSession.findUnique({ where: { id: user.currentSessionId }, select: { createdAt: true, revokedAt: true } });
    if (s && !s.revokedAt) sessionStartedAt = s.createdAt;
  }
  const reason = decideObservabilityAccess({
    role: user?.role,
    email: user?.email,
    totpEnabledAt: user?.totpEnabledAt,
    sessionStartedAt,
  });
  if (reason) return { deny: reason };
  return { ok: { userId: uid, email: user?.email ?? null, name: user?.name ?? null } };
}

/**
 * API gate. Returns the session or a 401/403 JSON Response to return directly:
 *   const gate = await requireObservabilityApi(); if (gate instanceof Response) return gate;
 */
export async function requireObservabilityApi(): Promise<ObsSession | Response> {
  try {
    const r = await evaluate();
    if ('ok' in r) return r.ok;
    if (r.deny === 'unauthenticated') return unauthenticated();
    if (r.deny === '2fa') {
      return forbidden('Observability requires a super-admin session signed in with Google Authenticator (2FA).');
    }
    return forbidden('Observability is restricted to platform super-admins.');
  } catch {
    return forbidden('Observability access check failed.');
  }
}

/** Page gate (server component): null when allowed, else the deny reason. */
export async function observabilityPageDenial(): Promise<ObsDenyReason | null> {
  try {
    const r = await evaluate();
    return 'ok' in r ? null : r.deny;
  } catch {
    return 'role';
  }
}

/**
 * The same SUPER_ADMIN + 2FA-session check, for other sensitive platform
 * actions (e.g. test accounts at /platform/users/test-accounts) that need the
 * observability-grade gate with their own wording.
 */
export async function superAdmin2faSession(): Promise<{ ok: ObsSession } | { deny: ObsDenyReason }> {
  try {
    return await evaluate();
  } catch {
    return { deny: 'role' };
  }
}

/** Shared parsing of ?range= (15m | 1h | 24h | 7d). */
export const RANGES = { '15m': 15, '1h': 60, '24h': 1440, '7d': 10080 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: string | null | undefined): { key: RangeKey; minutes: number; since: Date } {
  const key = (v && v in RANGES ? v : '1h') as RangeKey;
  const minutes = RANGES[key];
  return { key, minutes, since: new Date(Date.now() - minutes * 60_000) };
}
