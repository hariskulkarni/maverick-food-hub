/**
 * Restaurant-group scoping.
 *
 * A PARENT restaurant operates its whole group (itself + its children) as one:
 * the parent dashboard sees every group order, riders/reports/menus are managed
 * centrally. This module is the single source of truth for "what restaurants +
 * branches belong to the group rooted at X", plus the realtime channel the
 * parent board listens on.
 *
 * Channel design: each order also fans out to `group:{rootId}:orders` where the
 * root is the order's restaurant parent (or the restaurant itself when it's
 * top-level). So the parent board subscribes to ONE group channel and receives
 * events for every child + the parent, while a standalone restaurant's group
 * channel is simply itself — no behaviour change for solo tenants.
 */

import { prisma } from './db';

/** SSE/poll channel the group root listens on for all group order events. */
export function groupOrderChannel(rootId: string): string {
  return `group:${rootId}:orders`;
}

/**
 * The group root for a given restaurant: its parent if it's a child, else
 * itself. Orders publish to this root's group channel.
 */
export async function groupRootIdFor(restaurantId: string): Promise<string> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, parentId: true },
  });
  return r?.parentId ?? r?.id ?? restaurantId;
}

export interface BranchLabel {
  branchId: string;
  branchName: string;
  restaurantId: string;
  restaurantName: string;
  isParent: boolean;
}

export interface GroupContext {
  /** Group root restaurant id (the active restaurant when it's a parent/standalone). */
  rootId: string;
  rootName: string;
  /** True when the root actually has children (a real group, not a solo tenant). */
  isGroup: boolean;
  /** [root, ...children] — restaurants whose data the parent dashboard spans. */
  restaurantIds: string[];
  /** Per-restaurant summary for selectors + labels. */
  restaurants: { id: string; name: string; slug: string; isParent: boolean }[];
  /** All branch ids across the group's restaurants. */
  branchIds: string[];
  /** branchId → which restaurant it belongs to (for labelling each order). */
  labelByBranchId: Record<string, BranchLabel>;
  /** Realtime channel for the whole group's order feed. */
  channel: string;
}

/**
 * Resolve the group rooted at `restaurantId`. When the restaurant has children
 * the context spans them all; otherwise it's a single-restaurant context (a
 * child viewed directly, or a solo tenant) and isGroup is false. Children are
 * single-level (a child has no children of its own), so one query depth covers it.
 */
export async function resolveGroupContext(restaurantId: string): Promise<GroupContext> {
  const root = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true, name: true, slug: true,
      children: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, branches: { select: { id: true, name: true } } },
      },
      branches: { select: { id: true, name: true } },
    },
  });
  if (!root) {
    return {
      rootId: restaurantId, rootName: '', isGroup: false,
      restaurantIds: [restaurantId], restaurants: [], branchIds: [],
      labelByBranchId: {}, channel: groupOrderChannel(restaurantId),
    };
  }

  const restaurants = [
    { id: root.id, name: root.name, slug: root.slug, isParent: true },
    ...root.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isParent: false })),
  ];
  const labelByBranchId: Record<string, BranchLabel> = {};
  for (const b of root.branches) {
    labelByBranchId[b.id] = { branchId: b.id, branchName: b.name, restaurantId: root.id, restaurantName: root.name, isParent: true };
  }
  for (const c of root.children) {
    for (const b of c.branches) {
      labelByBranchId[b.id] = { branchId: b.id, branchName: b.name, restaurantId: c.id, restaurantName: c.name, isParent: false };
    }
  }

  return {
    rootId: root.id,
    rootName: root.name,
    isGroup: root.children.length > 0,
    restaurantIds: restaurants.map((r) => r.id),
    restaurants,
    branchIds: Object.keys(labelByBranchId),
    labelByBranchId,
    channel: groupOrderChannel(root.id),
  };
}

/**
 * Authorize the caller to act on `targetRestaurantId` within the group rooted at
 * the caller's active restaurant. The parent owner (active = a group root) may
 * act on the root + any child; otherwise only on the active restaurant itself.
 * Returns true when allowed.
 */
export async function canManageInGroup(activeRestaurantId: string, targetRestaurantId: string): Promise<boolean> {
  if (activeRestaurantId === targetRestaurantId) return true;
  const target = await prisma.restaurant.findUnique({
    where: { id: targetRestaurantId },
    select: { parentId: true },
  });
  return target?.parentId === activeRestaurantId;
}
