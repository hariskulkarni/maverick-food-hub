/**
 * Authorization for realtime (SSE + polling) channel subscriptions.
 *
 * Channels carry sensitive, tenant-scoped data (order status/location, the
 * kitchen order feed, live rider positions). Before this gate, ANY caller who
 * knew (or guessed) a channel name could subscribe to it. `authorizeRealtimeChannel`
 * enforces, per channel:
 *
 *   order:{orderId}                 → the owning customer, the assigned rider,
 *                                     an ADMIN/KITCHEN of the order's restaurant,
 *                                     or a SUPER_ADMIN.
 *   branch:{branchId}:orders        → ADMIN/KITCHEN of that branch's restaurant,
 *                                     or SUPER_ADMIN.
 *   branch:{branchId}:riders        → ADMIN of that branch's restaurant, or SUPER_ADMIN.
 *   group:{rootId}:orders           → ADMIN/KITCHEN whose accessible group root is
 *                                     rootId, or SUPER_ADMIN. (Primary orders feed.)
 *   rider:{riderId}[:*]             → that rider, or SUPER_ADMIN.
 *   platform:riders                 → SUPER_ADMIN only.
 *
 * Lives outside realtime.ts (kept dependency-light) because this needs Prisma +
 * the tenancy helpers. Kept lazy/awaitable so callers can `return 403` cleanly.
 */
import { Role } from '@prisma/client';
import { prisma } from './db';
import { accessibleSet } from './tenancy';

export interface RealtimeUser {
  id: string;
  role: Role;
}

/** Resolve whether `user` may subscribe to `channel`. Deny-by-default. */
export async function authorizeRealtimeChannel(
  user: RealtimeUser | null | undefined,
  channel: string
): Promise<boolean> {
  if (!user || !channel) return false;

  // Super admins see the whole platform.
  if (user.role === Role.SUPER_ADMIN) return true;

  // Platform firehose — super admin only (already returned true above).
  if (channel === 'platform:riders') return false;

  // ── order:{orderId} ───────────────────────────────────────────────────────
  if (channel.startsWith('order:')) {
    const orderId = channel.slice('order:'.length);
    if (!orderId) return false;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        branchId: true,
        assignment: { select: { rider: { select: { userId: true } } } },
      },
    });
    if (!order) return false;
    if (user.role === Role.CUSTOMER) return order.customerId === user.id;
    if (user.role === Role.RIDER) return order.assignment?.rider?.userId === user.id;
    if (user.role === Role.ADMIN || user.role === Role.KITCHEN) {
      const branch = await prisma.branch.findUnique({
        where: { id: order.branchId },
        select: { restaurantId: true },
      });
      if (!branch) return false;
      return (await accessibleSet(user.id)).has(branch.restaurantId);
    }
    return false;
  }

  // ── branch:{branchId}:orders | branch:{branchId}:riders ───────────────────
  if (channel.startsWith('branch:')) {
    const [branchId, sub] = channel.slice('branch:'.length).split(':');
    if (!branchId || !sub) return false;
    if (user.role !== Role.ADMIN && user.role !== Role.KITCHEN) return false;
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { restaurantId: true },
    });
    if (!branch) return false;
    const entry = (await accessibleSet(user.id)).get(branch.restaurantId);
    if (!entry) return false;
    if (sub === 'riders') return entry.role === Role.ADMIN; // ops view: admin only
    if (sub === 'orders') return true; // admin or kitchen
    return false;
  }

  // ── group:{rootId}:orders (the primary group-wide orders feed) ────────────
  if (channel.startsWith('group:')) {
    const [rootId, sub] = channel.slice('group:'.length).split(':');
    if (!rootId || sub !== 'orders') return false;
    if (user.role !== Role.ADMIN && user.role !== Role.KITCHEN) return false;
    for (const e of (await accessibleSet(user.id)).values()) {
      const groupRoot = e.restaurant.parentId ?? e.restaurant.id;
      if (groupRoot === rootId || e.restaurant.id === rootId) return true;
    }
    return false;
  }

  // ── rider:{riderId}[:location|:batch-invitation] ──────────────────────────
  if (channel.startsWith('rider:')) {
    const riderId = channel.slice('rider:'.length).split(':')[0];
    if (!riderId) return false;
    if (user.role !== Role.RIDER) return false;
    const profile = await prisma.riderProfile.findUnique({
      where: { id: riderId },
      select: { userId: true },
    });
    return !!profile && profile.userId === user.id;
  }

  // Unknown channel shape — deny by default.
  return false;
}
