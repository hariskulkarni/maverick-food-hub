/**
 * Single-active-session enforcement + login history.
 *
 * The app uses stateless JWT sessions, so "log the other device out" can't rely
 * on a server session store alone. Instead:
 *   - On each successful login we create a UserSession row and point
 *     User.currentSessionId at it, revoking every prior session for that user.
 *   - The new session id (sid) is stamped into the JWT.
 *   - On every request the `jwt` callback calls isSessionActive(uid, sid). The
 *     moment a newer login rotates currentSessionId, the older device's sid no
 *     longer matches → its token is treated as invalid → forced logout.
 *
 * This applies to ALL roles (customer, rider, kitchen, admin, super-admin).
 */

import { prisma } from './db';

export interface NewSessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Start a fresh session for a just-authenticated user: revoke all of their
 * existing sessions, create a new one, and make it the current session. Returns
 * the new session id to stamp into the JWT. Best-effort: on any DB error we
 * return null and the caller falls back to a session-less token (the user is
 * still logged in, just without single-device enforcement for that login).
 */
export async function startSession(userId: string, meta: NewSessionMeta = {}): Promise<string | null> {
  try {
    const now = new Date();
    const session = await prisma.$transaction(async (tx) => {
      // Revoke every currently-active session for this user (single device).
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'superseded' },
      });
      const created = await tx.userSession.create({
        data: {
          userId,
          userAgent: meta.userAgent ?? null,
          ipAddress: meta.ipAddress ?? null,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { currentSessionId: created.id } });
      return created;
    });
    return session.id;
  } catch {
    return null;
  }
}

/**
 * Is `sid` still the user's current, non-revoked session? Tokens minted before
 * single-session was deployed won't carry a sid — we treat a missing sid as
 * valid (grandfathered) so we don't mass-logout everyone on rollout; those
 * tokens get a real sid the next time the user logs in.
 */
export async function isSessionActive(userId: string, sid: string | undefined | null): Promise<boolean> {
  if (!sid) return true; // grandfather pre-rollout tokens
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { currentSessionId: true } });
    if (!user) return false;
    if (user.currentSessionId !== sid) return false;
    // Touch lastSeenAt opportunistically (fire-and-forget, never blocks auth).
    prisma.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } }).catch(() => {});
    return true;
  } catch {
    // On a transient DB error, fail OPEN (don't lock a legitimate user out over
    // a blip). The next request re-checks.
    return true;
  }
}

/** Revoke a single session (used by the security UI's "terminate" + on logout). */
export async function revokeSession(sessionId: string, reason = 'user_terminated'): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      // If this was someone's current session, clear the pointer so the token
      // stops validating immediately.
      await tx.user.updateMany({ where: { currentSessionId: sessionId }, data: { currentSessionId: null } });
    });
  } catch {
    /* best-effort */
  }
}

/** Recent login history for the security page (most recent first). */
export async function listSessions(userId: string, limit = 20) {
  const [rows, user] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastSeenAt: true, revokedAt: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { currentSessionId: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    active: r.revokedAt === null && r.id === user?.currentSessionId,
    revokedAt: r.revokedAt,
  }));
}
