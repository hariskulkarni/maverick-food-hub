/**
 * Shared auth gates for API routes — the single source of truth for
 * "who can hit this endpoint" so route handlers never reinvent the check
 * (or get it subtly wrong, like returning 403 when the real problem is the
 * session expired and the client should re-login).
 *
 * Why this exists:
 *   • Pre-fix, every route ad-hocked its own
 *       if (!session?.user) return 401
 *       if (role-check) return 403
 *     pattern, and most got it WRONG: a `session?.user.role !== Role.X` check
 *     conflates "no session" with "wrong role". Both came back as 403, so
 *     the client couldn't tell whether to redirect to login or show
 *     "permission denied".
 *   • Errors were also returned as bare text ("Forbidden") with no JSON
 *     body, so the client UI had to guess what message to show.
 *
 * Contract:
 *   • requireSuperAdminApi() / requireAnyAdminApi() return either a session
 *     OR a `Response` (401/403) with a JSON body `{ error, code }`.
 *     The route handler's first line is:
 *
 *       const gate = await requireSuperAdminApi();
 *       if (gate instanceof Response) return gate;
 *       const session = gate;
 *
 *   • Error codes are stable strings the client can act on:
 *       - "auth/unauthenticated" → no session; redirect to /login
 *       - "auth/forbidden"       → wrong role; tell the user, don't redirect
 *
 *   • These helpers DO NOT throw, so a missed `try/catch` can't accidentally
 *     200 a forbidden write (which is what an unhandled throw would do
 *     under Next's default error boundary).
 */
import { auth } from '@/server/auth';
import { Role } from '@prisma/client';

/** Stable error codes for the client to switch on. */
export type ApiAuthError = 'auth/unauthenticated' | 'auth/forbidden';

interface ApiAuthErrorBody {
  error: string;
  /** New name (used by everything fresh-built). */
  code: ApiAuthError;
  /**
   * Legacy alias so the menu-import client (which switched on `reason` earlier)
   * keeps working without a coordinated client/server change. Mapping:
   *   auth/unauthenticated → session_expired
   *   auth/forbidden       → role
   */
  reason: 'session_expired' | 'role';
}

function jsonError(status: number, body: ApiAuthErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 401 — caller has no valid session. The client should redirect to /login. */
export function unauthenticated(): Response {
  return jsonError(401, {
    error: 'You are signed out. Please sign in again to continue.',
    code: 'auth/unauthenticated',
    reason: 'session_expired',
  });
}

/** 403 — caller is authenticated but their role is wrong for this endpoint. */
export function forbidden(message = "You don't have permission to do that."): Response {
  return jsonError(403, {
    error: message,
    code: 'auth/forbidden',
    reason: 'role',
  });
}

/**
 * Require a SUPER_ADMIN session.
 * Returns the session on success, or a 401/403 Response the route MUST
 * return directly.
 */
export async function requireSuperAdminApi() {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  if (session.user.role !== Role.SUPER_ADMIN) {
    return forbidden('This action requires platform super-admin access.');
  }
  return session;
}

/**
 * Require a session whose role is in the "any admin" bucket — i.e. someone
 * who can plausibly write to the system. Used by the upload endpoint and
 * other shared admin surfaces.
 */
const ANY_ADMIN_ROLES: ReadonlyArray<string> = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.KITCHEN,
];

export async function requireAnyAdminApi() {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const role = (session.user as { role?: string }).role;
  if (!role || !ANY_ADMIN_ROLES.includes(role)) {
    return forbidden('This action requires admin, kitchen, or super-admin access.');
  }
  return session;
}

/**
 * Require a RESTAURANT-ADMIN session (Role.ADMIN only — not KITCHEN, not
 * SUPER_ADMIN). Use for the destructive menu / settings / branch surfaces
 * where a KITCHEN account should be read-only.
 *
 * Returns the session on success, or a 401/403 Response the route MUST
 * return directly:
 *
 *   const gate = await requireRestaurantAdminApi();
 *   if (gate instanceof Response) return gate;
 *   const session = gate;
 */
export async function requireRestaurantAdminApi() {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  if (session.user.role !== Role.ADMIN) {
    return forbidden('Only a restaurant admin can do that.');
  }
  return session;
}
