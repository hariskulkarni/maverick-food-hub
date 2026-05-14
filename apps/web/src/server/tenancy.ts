/**
 * Multi-tenant helpers.
 *
 *   currentRestaurant()  — returns the active restaurant for the logged-in
 *                          ADMIN/KITCHEN user, or null if super-admin/customer.
 *   requireRestaurant()  — same, but throws 404 if the user is not a restaurant member.
 *   requireSuperAdmin()  — throws 403 if not SUPER_ADMIN.
 */

import { auth } from './auth';
import { prisma } from './db';
import { Role } from '@prisma/client';

export async function currentRestaurant() {
  const session = await auth();
  if (!session?.user) return null;
  const tenantRoles: Role[] = [Role.ADMIN, Role.KITCHEN];
  if (!tenantRoles.includes(session.user.role)) return null;

  // Pick the first membership; multi-restaurant per user can be added later.
  const membership = await prisma.restaurantUser.findFirst({
    where: { userId: session.user.id },
    include: { restaurant: true }
  });
  return membership?.restaurant ?? null;
}

export async function requireRestaurant() {
  const r = await currentRestaurant();
  if (!r) throw new Response('No restaurant for this user', { status: 404 });
  return r;
}

export async function requireSuperAdmin() {
  const session = await auth();
  if (session?.user.role !== Role.SUPER_ADMIN) throw new Response('Forbidden', { status: 403 });
  return session;
}
