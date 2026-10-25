/**
 * Shared shapes for staff (admin/kitchen) order surfaces.
 *
 * P2-13: never ship full User rows (passwordHash, totpSecret, …) to staff
 * browsers — select only what a board shows. P2-15: boards load ACTIVE orders
 * separately from the recent-history window so a busy day can't push a live
 * order out of the "latest 100".
 */
import type { OrderStatus, Prisma } from '@prisma/client';

export const STAFF_USER_SELECT = { id: true, name: true, phone: true } as const;

/** Statuses an operator still has to act on (admin board "Active" + kitchen columns + rider legs). */
export const ACTIVE_BOARD_STATUSES: OrderStatus[] = [
  'RECEIVED', 'ACCEPTED', 'PREPARING', 'READY',
  'RIDER_ASSIGNED', 'RIDER_REACHED_RESTAURANT', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_REACHED_CUSTOMER',
  'DELIVERY_OTP_FAILED', 'CUSTOMER_UNREACHABLE',
];

/** Kitchen columns. */
export const KITCHEN_STATUSES: OrderStatus[] = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'];

/** Recent (any status) orders shown under the active ones on the admin board. */
export const BOARD_RECENT_LIMIT = 100;

/** Include for admin board rows. */
export const ADMIN_BOARD_INCLUDE = {
  customer: { select: STAFF_USER_SELECT },
  items: true,
  address: true,
  assignment: { include: { rider: { include: { user: { select: STAFF_USER_SELECT } } } } },
} satisfies Prisma.OrderInclude;

/** Include for kitchen board rows (combo constituents for the breakdown). */
export const KITCHEN_BOARD_INCLUDE = {
  items: { include: { combo: { include: { items: { include: { menuItem: { select: { name: true } } } } } } } },
  customer: { select: STAFF_USER_SELECT },
  reservation: { select: { table: { select: { name: true } } } },
} satisfies Prisma.OrderInclude;

/**
 * Admin board rows: every active order + the most recent BOARD_RECENT_LIMIT of
 * any status, de-duplicated, newest first.
 */
export async function loadAdminBoardOrders(
  prisma: { order: { findMany: (args: any) => Promise<any[]> } },
  branchIds: string[],
) {
  const [active, recent] = await Promise.all([
    prisma.order.findMany({
      where: { branchId: { in: branchIds }, status: { in: ACTIVE_BOARD_STATUSES } },
      include: ADMIN_BOARD_INCLUDE,
      orderBy: { placedAt: 'desc' },
    }),
    prisma.order.findMany({
      where: { branchId: { in: branchIds } },
      include: ADMIN_BOARD_INCLUDE,
      orderBy: { placedAt: 'desc' },
      take: BOARD_RECENT_LIMIT,
    }),
  ]);
  const seen = new Set<string>();
  return [...active, ...recent]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
}

/** Pre-compute `comboBreakdown` per line so the kitchen client stays dumb. */
export function withComboBreakdown<T extends { items: any[] }>(o: T) {
  return {
    ...o,
    items: o.items.map((i: any) => ({
      ...i,
      comboBreakdown: i.combo
        ? (i.combo.items as any[]).map((ci) => ({ name: ci.menuItem?.name ?? 'Unknown item', qty: ci.quantity }))
        : null,
    })),
  };
}
