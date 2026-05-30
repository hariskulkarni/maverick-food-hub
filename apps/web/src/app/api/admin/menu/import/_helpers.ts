/**
 * Shared auth + branch-resolution for the menu import/export route handlers.
 *
 * Why this file got rewritten:
 *   The original helper returned a single bare "Forbidden" 403 for every
 *   failure mode — expired session, missing role, no restaurant link, no
 *   active branch all surfaced as the same opaque toast in the UI. The CMS
 *   user couldn't tell whether to re-log-in, switch outlet, or add a branch.
 *
 * What this file does now:
 *   Returns STRUCTURED JSON errors with both a human message and a stable
 *   `reason` code, plus the right HTTP status for each case. The panel reads
 *   `reason` to render an actionable toast (re-sign-in button, link to
 *   /admin/branches, etc.) so a real fix is one click away.
 *
 * Reasons the panel knows how to render:
 *   401 session_expired   → Auth cookie missing/invalid (or session got
 *                            revoked from another tab). Tell user to sign in.
 *   403 role              → Not an ADMIN of any restaurant.
 *   404 no_restaurant     → Account isn't linked to a restaurant yet.
 *   404 no_active_branch  → Restaurant exists but every branch is paused/missing.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { currentRestaurant } from '@/server/tenancy';

export type ScopeError = {
  status: number;
  reason: 'session_expired' | 'role' | 'no_restaurant' | 'no_active_branch';
  error: string;
};
export type BranchScope =
  | { branchId: string; restaurantId: string; restaurantName: string }
  | { error: Response };

function jsonError(err: ScopeError): Response {
  return Response.json(
    { error: err.error, reason: err.reason },
    { status: err.status }
  );
}

export async function resolveBranchScope(): Promise<BranchScope> {
  // 1) Session. A missing/expired/revoked JWT is a 401 — distinct from a 403
  //    "wrong role" so the UI can prompt for re-sign-in instead of guessing.
  const session = await auth();
  if (!session?.user) {
    return {
      error: jsonError({
        status: 401,
        reason: 'session_expired',
        error: 'Your session has expired. Sign in again and retry the import.',
      }),
    };
  }

  // 2) Role. Only a restaurant ADMIN can import menus into a restaurant. (Super
  //    admins manage menus from /platform with a separate scope and don't reach
  //    this endpoint.) Keep the check strict on ADMIN — KITCHEN staff can browse
  //    the menu but shouldn't bulk-rewrite it.
  if (session.user.role !== 'ADMIN') {
    return {
      error: jsonError({
        status: 403,
        reason: 'role',
        error: 'Only a restaurant admin can bulk-import the menu.',
      }),
    };
  }

  // 3) Active restaurant. Don't throw — `requireRestaurant` raises a Response
  //    we'd have to catch and translate anyway. Use the underlying helper.
  const restaurant = await currentRestaurant();
  if (!restaurant) {
    return {
      error: jsonError({
        status: 404,
        reason: 'no_restaurant',
        error: 'Your account isn\'t linked to a restaurant yet. Ask the platform team to grant access, then retry.',
      }),
    };
  }

  // 4) Branch. Menus live on a Branch, so we need at least one ACTIVE branch
  //    of the selected restaurant. A common gotcha is that the admin paused
  //    every branch — point them straight at /admin/branches to fix it.
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!branch) {
    return {
      error: jsonError({
        status: 404,
        reason: 'no_active_branch',
        error: `${restaurant.name} has no active branch. Open Branches and activate one, then retry.`,
      }),
    };
  }

  return { branchId: branch.id, restaurantId: restaurant.id, restaurantName: restaurant.name };
}
