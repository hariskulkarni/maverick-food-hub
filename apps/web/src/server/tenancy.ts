/**
 * Multi-tenant helpers.
 *
 *   currentRestaurant()      — the ACTIVE restaurant for the logged-in
 *                              ADMIN/KITCHEN user (honours the account switcher
 *                              cookie), or null if super-admin/customer.
 *   requireRestaurant()      — same, but throws 404 if the user is not a member.
 *   accessibleRestaurants()  — every restaurant the user may switch into
 *                              (their RestaurantUser grants), grouped parent→child.
 *   resolveGroupSharing()    — effective group sharing flags for a restaurant
 *                              (a child inherits its parent's toggles).
 *   requireSuperAdmin()      — throws 403 if not SUPER_ADMIN.
 *
 * Account switching: a user may have RestaurantUser grants to several
 * restaurants (e.g. a parent + its children). The active one is stored in the
 * `active_restaurant` cookie, written by POST /api/admin/active-restaurant.
 * currentRestaurant() only READS the cookie (safe in a Server Component) and
 * always validates the id against the caller's memberships before honouring it,
 * so a forged cookie can never grant access to a restaurant the user isn't a
 * member of. If the cookie is missing/invalid we fall back to the first grant.
 */

import { cookies } from 'next/headers';
import { auth } from './auth';
import { prisma } from './db';
import { Role } from '@prisma/client';
import { can, type Capability } from './permissions';

export const ACTIVE_RESTAURANT_COOKIE = 'active_restaurant';

const TENANT_ROLES: Role[] = [Role.ADMIN, Role.KITCHEN];

type RestaurantRecord = Awaited<ReturnType<typeof prisma.restaurant.findFirstOrThrow>>;
interface AccessEntry {
  restaurant: RestaurantRecord;
  role: Role;
  /** true when access is implied by owning/administering the parent (not an explicit grant). */
  implied: boolean;
}

/** Membership rows (restaurant + the caller's role in it) for the current user. */
async function membershipsForUser(userId: string) {
  return prisma.restaurantUser.findMany({
    where: { userId },
    include: { restaurant: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The full set of restaurants a user may operate, in stable order:
 *   1. explicit RestaurantUser grants (their primary first, by createdAt)
 *   2. restaurants they OWN (ownerUserId) even without a grant row
 *   3. CHILDREN of any restaurant they own or ADMIN — the parent-owner "sees
 *      all" rule, so a group owner reaches every child without per-child grants.
 *   4. CHILDREN of any restaurant they have a KITCHEN grant on — so one kitchen
 *      login attached to the umbrella covers every child kitchen (implied KITCHEN).
 * A KITCHEN grant on a standalone restaurant (no children) is unaffected.
 * Keyed by restaurantId; insertion order defines the switcher fallback order.
 */
export async function accessibleSet(userId: string): Promise<Map<string, AccessEntry>> {
  const map = new Map<string, AccessEntry>();

  const memberships = await membershipsForUser(userId);
  for (const m of memberships) {
    map.set(m.restaurantId, { restaurant: m.restaurant, role: m.role, implied: false });
  }

  // Roots whose children this user implicitly reaches: restaurants they own, or
  // are an ADMIN member of. (KITCHEN grants don't cascade to children.)
  const owned = await prisma.restaurant.findMany({ where: { ownerUserId: userId } });
  for (const r of owned) {
    if (!map.has(r.id)) map.set(r.id, { restaurant: r, role: Role.ADMIN, implied: false });
  }
  const rootIds = new Set<string>([
    ...owned.map((r) => r.id),
    ...memberships.filter((m) => m.role === Role.ADMIN).map((m) => m.restaurantId),
  ]);
  if (rootIds.size > 0) {
    const children = await prisma.restaurant.findMany({ where: { parentId: { in: [...rootIds] } } });
    for (const c of children) {
      if (!map.has(c.id)) map.set(c.id, { restaurant: c, role: Role.ADMIN, implied: true });
    }
  }

  // A KITCHEN grant on a parent/umbrella restaurant cascades to its child
  // restaurants — so ONE kitchen login attached to the umbrella covers every
  // child kitchen (a single consolidated console), without per-child grants.
  // Mirrors the ADMIN cascade but keeps the KITCHEN role on implied children.
  // Explicit grants + ADMIN-implied entries set above always take precedence.
  const kitchenRootIds = memberships
    .filter((m) => m.role === Role.KITCHEN)
    .map((m) => m.restaurantId);
  if (kitchenRootIds.length > 0) {
    const kitchenChildren = await prisma.restaurant.findMany({ where: { parentId: { in: kitchenRootIds } } });
    for (const c of kitchenChildren) {
      if (!map.has(c.id)) map.set(c.id, { restaurant: c, role: Role.KITCHEN, implied: true });
    }
  }
  return map;
}

/** Whether the user may operate the given restaurant (explicit grant or implied via ownership). */
export async function userCanAccessRestaurant(userId: string, restaurantId: string): Promise<boolean> {
  const set = await accessibleSet(userId);
  return set.has(restaurantId);
}

export async function currentRestaurant() {
  const session = await auth();
  if (!session?.user) return null;
  if (!TENANT_ROLES.includes(session.user.role)) return null;

  const set = await accessibleSet(session.user.id);
  if (set.size === 0) return null;
  const entries = [...set.values()];

  // Honour the account-switcher cookie ONLY when it points at a restaurant the
  // user can actually access (defends against a tampered cookie).
  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_RESTAURANT_COOKIE)?.value;
  if (activeId && set.has(activeId)) {
    return set.get(activeId)!.restaurant;
  }
  // Fallback: first accessible restaurant (explicit grants ordered first).
  return entries[0].restaurant;
}

export async function requireRestaurant() {
  const r = await currentRestaurant();
  if (!r) throw new Response('No restaurant for this user', { status: 404 });
  return r;
}

export interface AccessibleRestaurant {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: Role;
  parentId: string | null;
  /** Convenience flag — this restaurant is the root of a group (has children OR no parent but others point to it). */
  isParent: boolean;
}

export interface AccessibleGroup {
  /** The parent restaurant the caller can access, if any (else null = ungrouped). */
  parent: AccessibleRestaurant | null;
  /** Children (or, for the null group, standalone restaurants) the caller can access. */
  members: AccessibleRestaurant[];
}

/**
 * Every restaurant the current user may switch into, plus a grouped view for
 * the dropdown. Access is membership-based (explicit RestaurantUser grants) —
 * being a parent does NOT auto-grant the children; each must be granted.
 */
export async function accessibleRestaurants(): Promise<{
  flat: AccessibleRestaurant[];
  groups: AccessibleGroup[];
  activeId: string | null;
}> {
  const session = await auth();
  if (!session?.user || !TENANT_ROLES.includes(session.user.role)) {
    return { flat: [], groups: [], activeId: null };
  }
  const set = await accessibleSet(session.user.id);
  const entries = [...set.values()];
  const accessibleIds = new Set(entries.map((e) => e.restaurant.id));

  const flat: AccessibleRestaurant[] = entries.map((e) => ({
    id: e.restaurant.id,
    name: e.restaurant.name,
    slug: e.restaurant.slug,
    status: e.restaurant.status,
    role: e.role,
    parentId: e.restaurant.parentId,
    // A restaurant is shown as a group root if it has no parent of its own AND
    // at least one accessible sibling names it as parent.
    isParent:
      e.restaurant.parentId === null &&
      entries.some((other) => other.restaurant.parentId === e.restaurant.id),
  }));

  // Build grouped view. A child whose parent the caller can also access nests
  // under that parent; everything else lands in the null (ungrouped) bucket.
  const byId = new Map(flat.map((r) => [r.id, r]));
  const groupsMap = new Map<string | null, AccessibleGroup>();
  // Where does a restaurant belong?
  //   • a child whose parent is also accessible → under that parent's group
  //   • a group root (isParent) → heads its OWN group (never the ungrouped bucket)
  //   • anything else (standalone) → the null (ungrouped) bucket
  // Routing a group root to its own id (rather than null) is what prevents the
  // parent from appearing twice — once as a standalone ungrouped entry and again
  // as its group header.
  const groupKeyFor = (r: AccessibleRestaurant): string | null => {
    if (r.parentId && accessibleIds.has(r.parentId)) return r.parentId;
    if (r.isParent) return r.id;
    return null;
  };

  for (const r of flat) {
    const key = groupKeyFor(r);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { parent: key ? byId.get(key) ?? null : null, members: [] });
    }
    // The parent itself is the group header, not a member of its own bucket.
    if (key !== null && r.id === key) continue;
    groupsMap.get(key)!.members.push(r);
  }

  const cookieStore = await cookies();
  const cookieId = cookieStore.get(ACTIVE_RESTAURANT_COOKIE)?.value ?? null;
  const activeId =
    cookieId && accessibleIds.has(cookieId) ? cookieId : entries[0]?.restaurant.id ?? null;

  return { flat, groups: Array.from(groupsMap.values()), activeId };
}

export interface OrderScope {
  /** Every restaurant the caller can manage (used to scope order monitoring). */
  restaurantIds: string[];
  /** All branches across those restaurants. */
  branchIds: string[];
  /** True when the caller manages more than one restaurant — drives labels/filter. */
  multi: boolean;
  /** For the per-restaurant filter (the active/primary restaurant first). */
  restaurants: { id: string; name: string }[];
  /** branchId → its source restaurant, for labelling every order row. */
  labelByBranchId: Record<string, { restaurantId: string; restaurantName: string; branchName: string }>;
  /** Per-branch channels (legacy; prefer `groupChannel` to avoid opening one SSE per branch). */
  channels: string[];
  /**
   * A SINGLE realtime channel covering the active restaurant's whole group
   * (`group:{rootId}:orders`, where root = the active restaurant's parent or
   * itself). Orders fan out here on placement + every status change, so ONE SSE
   * connection covers parent + all children — critical because browsers cap
   * HTTP/1.1 at ~6 connections per host, and one-per-branch exhausts that pool.
   */
  groupChannel: string;
  /** The caller's active/primary restaurant + its first branch (for pause controls etc.). */
  activeRestaurantId: string;
  primaryBranchId: string | null;
}

/**
 * The order-monitoring scope for the current user: EVERY restaurant they can
 * manage (not just the active one), so an operator with several restaurants
 * sees orders from all of them — an order can never be "invisible" just because
 * the wrong restaurant is active. Each order is labelled with its restaurant.
 * For a single-restaurant user this collapses to exactly that one restaurant.
 */
export async function accessibleOrderScope(): Promise<OrderScope | null> {
  const session = await auth();
  if (!session?.user || !TENANT_ROLES.includes(session.user.role)) return null;
  const set = await accessibleSet(session.user.id);
  if (set.size === 0) return null;
  const entries = [...set.values()];

  // Active restaurant first (honours the switcher cookie), then the rest — so
  // the filter dropdown and primary branch default to what the user picked.
  const active = await currentRestaurant();
  const restaurantIds = entries.map((e) => e.restaurant.id);
  const ordered = [
    ...(active ? [active.id] : []),
    ...restaurantIds.filter((id) => id !== active?.id),
  ];

  const branches = await prisma.branch.findMany({
    where: { restaurantId: { in: restaurantIds } },
    select: { id: true, name: true, restaurantId: true },
  });
  const nameById = new Map(entries.map((e) => [e.restaurant.id, e.restaurant.name]));
  const labelByBranchId: Record<string, { restaurantId: string; restaurantName: string; branchName: string }> = {};
  for (const b of branches) {
    labelByBranchId[b.id] = {
      restaurantId: b.restaurantId,
      restaurantName: nameById.get(b.restaurantId) ?? '',
      branchName: b.name,
    };
  }
  const branchIds = branches.map((b) => b.id);
  const primaryBranchId =
    branches.find((b) => b.restaurantId === active?.id)?.id ?? branchIds[0] ?? null;

  // ONE channel for the active restaurant's whole group. Orders publish to
  // group:{parentId ?? selfId}:orders, so a parent owner subscribing here gets
  // parent + every child over a single SSE connection (no per-branch fan-out).
  const groupRootId = active?.parentId ?? active?.id ?? restaurantIds[0];

  return {
    restaurantIds,
    branchIds,
    multi: restaurantIds.length > 1,
    restaurants: ordered.map((id) => ({ id, name: nameById.get(id) ?? '' })),
    labelByBranchId,
    channels: branchIds.map((id) => `branch:${id}:orders`),
    groupChannel: `group:${groupRootId}:orders`,
    activeRestaurantId: active?.id ?? restaurantIds[0],
    primaryBranchId,
  };
}

export interface GroupSharing {
  /** The restaurant whose toggles are in effect (self if top-level, else the parent). */
  sourceRestaurantId: string;
  isChild: boolean;
  shareMenu: boolean;
  shareRiders: boolean;
  shareReports: boolean;
}

/**
 * Resolve the EFFECTIVE group sharing flags for a restaurant. A child inherits
 * its parent's toggles (the parent owns the group policy); a top-level
 * restaurant uses its own. Returns all-false when there's no grouping.
 */
export async function resolveGroupSharing(restaurantId: string): Promise<GroupSharing> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      parentId: true,
      groupShareMenu: true,
      groupShareRiders: true,
      groupShareReports: true,
      parent: {
        select: { id: true, groupShareMenu: true, groupShareRiders: true, groupShareReports: true },
      },
    },
  });
  if (!r) {
    return { sourceRestaurantId: restaurantId, isChild: false, shareMenu: false, shareRiders: false, shareReports: false };
  }
  if (r.parentId && r.parent) {
    return {
      sourceRestaurantId: r.parent.id,
      isChild: true,
      shareMenu: r.parent.groupShareMenu,
      shareRiders: r.parent.groupShareRiders,
      shareReports: r.parent.groupShareReports,
    };
  }
  return {
    sourceRestaurantId: r.id,
    isChild: false,
    shareMenu: r.groupShareMenu,
    shareRiders: r.groupShareRiders,
    shareReports: r.groupShareReports,
  };
}

export async function requireSuperAdmin() {
  const session = await auth();
  if (session?.user.role !== Role.SUPER_ADMIN) throw new Response('Forbidden', { status: 403 });
  return session;
}

/**
 * Require a session whose ROLE holds `capability` (see src/server/permissions.ts).
 * SUPER_ADMIN holds every capability, so this is a strict superset-safe
 * replacement for requireSuperAdmin() on surfaces we want to delegate to
 * platform-team roles. Throws a 403 Response (caught by the App Router) when
 * the capability is missing. Use in server components / server actions:
 *
 *   const session = await requireCapability('cms:read');
 */
export async function requireCapability(capability: Capability) {
  const session = await auth();
  // Narrow `session` (and session.user) to non-null on the happy path, exactly
  // like requireSuperAdmin — so callers can use `session.user.*` without a
  // possibly-null type error.
  if (!session?.user || !can(session.user.role, capability)) {
    throw new Response('Forbidden', { status: 403 });
  }
  return session;
}
