/**
 * Shared auth + scoping for the restaurant-group ("parent ↔ children") admin
 * APIs. The "group root" is the caller's ACTIVE restaurant (account-switcher
 * aware via currentRestaurant()). Structural changes — linking/unlinking a
 * child, granting access — require the caller to be a member of BOTH the parent
 * and the restaurant being changed, so an admin can only group restaurants they
 * already administer. No account creation: access can only be granted to a user
 * who already exists.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { currentRestaurant } from '@/server/tenancy';
import { Role } from '@prisma/client';

type Guard<T> = T | { error: Response };

/** ADMIN-role check + resolve the caller's active restaurant (the group root). */
export async function requireActiveRestaurant(): Promise<Guard<{ userId: string; restaurant: Awaited<ReturnType<typeof currentRestaurant>> & {} }>> {
  const session = await auth();
  if (session?.user.role !== Role.ADMIN) {
    return { error: new Response('Forbidden', { status: 403 }) };
  }
  const restaurant = await currentRestaurant();
  if (!restaurant) return { error: new Response('No restaurant for this user', { status: 404 }) };
  return { userId: session.user.id, restaurant };
}

/** True when `userId` holds a membership for `restaurantId`. */
export async function isMemberOf(userId: string, restaurantId: string): Promise<boolean> {
  const m = await prisma.restaurantUser.findFirst({
    where: { userId, restaurantId },
    select: { id: true },
  });
  return !!m;
}

export interface GroupChild {
  id: string;
  name: string;
  slug: string;
  status: string;
  // The members (admins/kitchen) currently granted access to this child.
  members: { userId: string; name: string | null; email: string | null; role: Role }[];
}

/** Serialize the active restaurant + its children + sharing toggles for the UI. */
export async function serializeGroup(rootId: string) {
  const root = await prisma.restaurant.findUnique({
    where: { id: rootId },
    select: {
      id: true, name: true, slug: true, status: true, parentId: true,
      groupShareMenu: true, groupShareRiders: true, groupShareReports: true,
      parent: { select: { id: true, name: true, slug: true } },
      children: {
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, slug: true, status: true,
          members: {
            select: { userId: true, role: true, user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  if (!root) return null;
  const children: GroupChild[] = root.children.map((c) => ({
    id: c.id, name: c.name, slug: c.slug, status: c.status,
    members: c.members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })),
  }));
  return {
    id: root.id,
    name: root.name,
    slug: root.slug,
    status: root.status,
    // A child can't itself host children in this single-level model — surface
    // its parent so the UI can say "managed under <parent>".
    parent: root.parent,
    isChild: !!root.parentId,
    sharing: {
      groupShareMenu: root.groupShareMenu,
      groupShareRiders: root.groupShareRiders,
      groupShareReports: root.groupShareReports,
    },
    children,
  };
}
