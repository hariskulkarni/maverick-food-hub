/**
 * Auth gates for Flavrly PG admin surfaces.
 *
 * Restaurant side: the caller's GLOBAL role must be ADMIN and their role IN the active
 * restaurant must be ADMIN too (a user can be ADMIN globally but only KITCHEN on one
 * restaurant). KITCHEN never passes (threat model T-04). The restaurant is always the
 * caller's active restaurant; a client-supplied restaurant id is never trusted.
 *
 * Platform PG routes use requireSuperAdminApi (SUPER_ADMIN only).
 *
 * Returns `{ session, restaurant }` or a 401/403/404 Response the route must return.
 */
import { Prisma, Role } from '@prisma/client';
import { auth } from '../auth';
import { accessibleSet, currentRestaurant } from '../tenancy';
import { forbidden, unauthenticated } from '../api-auth';
import { ReceivingAccountError } from './receiving-accounts';

export async function requirePgRestaurantAdmin() {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  if (session.user.role !== Role.ADMIN) return forbidden('Only a restaurant admin can do that.');
  const restaurant = await currentRestaurant();
  if (!restaurant) return Response.json({ error: 'No restaurant for this user' }, { status: 404 });
  const entry = (await accessibleSet(session.user.id)).get(restaurant.id);
  if (!entry || entry.role !== Role.ADMIN) return forbidden('Only a restaurant admin can do that.');
  return { session, restaurant };
}

/**
 * Map a PG service error to a JSON response for SUPER_ADMIN routes. Service/engine guard
 * failures (self-approval, wrong state, missing reason) are plain Errors with operator-safe
 * messages -> 409. Database/driver errors are rethrown (generic 500, no internals leaked).
 */
export function pgServiceErrorResponse(e: unknown): Response {
  if (e instanceof ReceivingAccountError) return Response.json({ error: e.message, code: e.code }, { status: e.httpStatus });
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) throw e;
  if (e instanceof Error) {
    // Service errors that carry an operator-safe HTTP status (OpsActionError, PgRefundError, ...).
    const status = (e as { status?: unknown }).status;
    return Response.json({ error: e.message }, { status: typeof status === 'number' && status >= 400 && status < 500 ? status : 409 });
  }
  throw e;
}
