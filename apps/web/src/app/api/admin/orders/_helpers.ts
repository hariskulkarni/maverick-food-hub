/**
 * C12 — tenant scoping for the admin order routes.
 *
 * Every admin order route was gated by role only (requireAnyAdminApi), with no
 * check that the target order belongs to the caller's restaurant, so a KITCHEN
 * or ADMIN at restaurant A could act on / read any other tenant's order by id.
 *
 * SUPER_ADMIN legitimately spans all tenants (scopeRestaurantId = null). ADMIN
 * and KITCHEN are pinned to their own restaurant; the ownership predicate goes
 * in the QUERY so it fails closed.
 */
import { prisma } from '@/server/db';
import { requireAnyAdminApi, requireRestaurantAdminApi } from '@/server/api-auth';
import { currentRestaurant } from '@/server/tenancy';
import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

type Guard<T> = T | { error: Response };

export interface OrderAdminScope {
  session: Session;
  /** null = SUPER_ADMIN, unrestricted. Otherwise the caller's restaurant id. */
  scopeRestaurantId: string | null;
}

/** Resolve the admin session and the restaurant it may act within. */
export async function requireOrderAdminScope(): Promise<Guard<OrderAdminScope>> {
  const gate = await requireAnyAdminApi();
  if (gate instanceof Response) return { error: gate };
  const role = (gate.user as { role?: string }).role;
  if (role === Role.SUPER_ADMIN) return { session: gate, scopeRestaurantId: null };
  const r = await currentRestaurant();
  if (!r) return { error: Response.json({ error: 'No restaurant for this user.', reason: 'no_restaurant' }, { status: 404 }) };
  return { session: gate, scopeRestaurantId: r.id };
}

/** A prisma `where` for an order, constrained to the caller's tenant (or not, for super-admin). */
export function orderScopeWhere(id: string, scopeRestaurantId: string | null) {
  return scopeRestaurantId ? { id, branch: { restaurantId: scopeRestaurantId } } : { id };
}

/** Confirm `orderId` is visible to the caller; returns the scope or a 404. */
export async function requireOwnedOrder(orderId: string): Promise<Guard<OrderAdminScope>> {
  const s = await requireOrderAdminScope();
  if ('error' in s) return s;
  const order = await prisma.order.findFirst({ where: orderScopeWhere(orderId, s.scopeRestaurantId), select: { id: true } });
  if (!order) return { error: Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 }) };
  return s;
}

/**
 * Ownership check for the ADMIN-only order routes (rider assignment). Keeps the
 * stricter requireRestaurantAdminApi gate (no KITCHEN, no SUPER_ADMIN) and pins
 * the order to the caller's restaurant.
 */
export async function requireOwnedOrderForAdmin(orderId: string): Promise<Guard<{ session: Session; restaurantId: string }>> {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return { error: gate };
  const r = await currentRestaurant();
  if (!r) return { error: Response.json({ error: 'No restaurant for this user.', reason: 'no_restaurant' }, { status: 404 }) };
  const order = await prisma.order.findFirst({ where: { id: orderId, branch: { restaurantId: r.id } }, select: { id: true } });
  if (!order) return { error: Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 }) };
  return { session: gate, restaurantId: r.id };
}
