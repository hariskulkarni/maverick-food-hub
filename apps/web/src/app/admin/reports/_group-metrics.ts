/**
 * Group-aware metric helpers for the parent dashboard + reports.
 *
 * When the active restaurant is a group PARENT (resolveGroupContext().isGroup)
 * AND the parent has groupShareReports enabled, headline metrics roll up across
 * every branch in the group, and we expose a per-child breakdown table. When the
 * restaurant is solo (or rollup is disabled) callers fall back to the existing
 * single-branch analytics, so solo tenants are never regressed.
 *
 * All Decimal totals are converted to Number here before they leave the server.
 */
import { prisma } from '@/server/db';
import { resolveGroupContext, type GroupContext } from '@/server/group-scope';
import { OrderStatus } from '@prisma/client';

import { REVENUE_STATUS_FILTER } from '@/server/reports/revenue';
import { istStartOfDay, istEndOfDay, istDayKey, lastIstDayKeys } from '@/lib/ist';

// IST day boundaries (P1-8) and the shared revenue include-list (P1-6).
const startOfDay = (d = new Date()) => istStartOfDay(d);
const endOfDay = (d = new Date()) => istEndOfDay(d);

const PAID = REVENUE_STATUS_FILTER;

export interface GroupReport {
  /** True when we should render the group rollup UI (real group + sharing on). */
  rollup: boolean;
  /** True when the active restaurant is a real group parent (children exist). */
  isGroup: boolean;
  /** True when rollup is *available* but switched off via groupShareReports. */
  rollupAvailableButOff: boolean;
  ctx: GroupContext;
  /** Branch ids the headline metrics should span (group branches, or ALL of this restaurant's branches). */
  branchIds: string[];
}

/**
 * Decide the reporting scope for the active restaurant. Without a rollup the
 * scope is EVERY branch of this restaurant (not just its primary — P1-9); when
 * we roll up we span every group branch instead.
 */
export async function resolveGroupReport(restaurantId: string): Promise<GroupReport> {
  const ctx = await resolveGroupContext(restaurantId);
  let shareReports = false;
  if (ctx.isGroup) {
    const root = await prisma.restaurant.findUnique({
      where: { id: ctx.rootId },
      select: { groupShareReports: true },
    });
    shareReports = !!root?.groupShareReports;
  }
  const rollup = ctx.isGroup && shareReports;
  const ownBranchIds = rollup
    ? []
    : (await prisma.branch.findMany({ where: { restaurantId }, select: { id: true } })).map((b) => b.id);
  return {
    rollup,
    isGroup: ctx.isGroup,
    rollupAvailableButOff: ctx.isGroup && !shareReports,
    ctx,
    branchIds: rollup ? ctx.branchIds : ownBranchIds,
  };
}

export interface ChildBreakdownRow {
  restaurantId: string;
  restaurantName: string;
  isParent: boolean;
  orders: number;
  revenue: number;
}

/**
 * Per-restaurant revenue + order count for today (parent included, labelled).
 * Used by the parent dashboard's group breakdown table. Revenue counts only
 * non-cancelled/failed orders, matching dashboardKpis.
 */
export async function childBreakdownToday(ctx: GroupContext): Promise<ChildBreakdownRow[]> {
  const today = startOfDay();
  const todayEnd = endOfDay();
  const grouped = await prisma.order.groupBy({
    by: ['branchId'],
    where: { branchId: { in: ctx.branchIds }, placedAt: { gte: today, lte: todayEnd }, status: PAID },
    _sum: { total: true },
    _count: { _all: true },
  });

  // Fold per-branch aggregates up to their owning restaurant.
  const byRestaurant = new Map<string, { orders: number; revenue: number }>();
  for (const r of ctx.restaurants) byRestaurant.set(r.id, { orders: 0, revenue: 0 });
  for (const g of grouped) {
    const label = ctx.labelByBranchId[g.branchId];
    if (!label) continue;
    const acc = byRestaurant.get(label.restaurantId) ?? { orders: 0, revenue: 0 };
    acc.orders += g._count._all;
    acc.revenue += Number(g._sum.total ?? 0);
    byRestaurant.set(label.restaurantId, acc);
  }

  return ctx.restaurants.map((r) => {
    const acc = byRestaurant.get(r.id) ?? { orders: 0, revenue: 0 };
    return { restaurantId: r.id, restaurantName: r.name, isParent: r.isParent, orders: acc.orders, revenue: acc.revenue };
  });
}

export interface GroupKpis {
  todayOrders: number;
  todayRevenue: number;
  pending: number;
  activeDeliveries: number;
}

/** Headline KPIs aggregated across an arbitrary set of branches. */
export async function groupKpis(branchIds: string[]): Promise<GroupKpis> {
  const today = startOfDay();
  const todayEnd = endOfDay();
  const where = { branchId: { in: branchIds } };
  const [todayOrders, todayPaid, pending, activeDeliveries] = await Promise.all([
    prisma.order.count({ where: { ...where, placedAt: { gte: today, lte: todayEnd }, status: PAID } }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { ...where, placedAt: { gte: today, lte: todayEnd }, status: PAID },
    }),
    prisma.order.count({ where: { ...where, status: { in: [OrderStatus.RECEIVED] } } }),
    prisma.order.count({ where: { ...where, status: OrderStatus.OUT_FOR_DELIVERY } }),
  ]);
  return {
    todayOrders,
    todayRevenue: Number(todayPaid._sum.total ?? 0),
    pending,
    activeDeliveries,
  };
}

export interface GroupRangeRow {
  restaurantId: string;
  restaurantName: string;
  isParent: boolean;
  orders: number;
  revenue: number;
}

/** Per-restaurant revenue + orders over the trailing `days` window (reports page). */
export async function childBreakdownRange(ctx: GroupContext, days = 30): Promise<GroupRangeRow[]> {
  const since = new Date(); since.setDate(since.getDate() - days);
  const grouped = await prisma.order.groupBy({
    by: ['branchId'],
    where: { branchId: { in: ctx.branchIds }, placedAt: { gte: since }, status: PAID },
    _sum: { total: true },
    _count: { _all: true },
  });
  const byRestaurant = new Map<string, { orders: number; revenue: number }>();
  for (const r of ctx.restaurants) byRestaurant.set(r.id, { orders: 0, revenue: 0 });
  for (const g of grouped) {
    const label = ctx.labelByBranchId[g.branchId];
    if (!label) continue;
    const acc = byRestaurant.get(label.restaurantId) ?? { orders: 0, revenue: 0 };
    acc.orders += g._count._all;
    acc.revenue += Number(g._sum.total ?? 0);
    byRestaurant.set(label.restaurantId, acc);
  }
  return ctx.restaurants.map((r) => {
    const acc = byRestaurant.get(r.id) ?? { orders: 0, revenue: 0 };
    return { restaurantId: r.id, restaurantName: r.name, isParent: r.isParent, orders: acc.orders, revenue: acc.revenue };
  });
}

/** Sales series (daily revenue) aggregated across many branches — group rollup. */
export async function groupSalesSeries(branchIds: string[], days = 14) {
  const keys = lastIstDayKeys(days);
  const rows = await prisma.order.findMany({
    where: { branchId: { in: branchIds }, placedAt: { gte: istStartOfDay(keys[0]) }, status: PAID },
    select: { placedAt: true, total: true },
  });
  const buckets = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = istDayKey(r.placedAt);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(r.total));
  }
  return Array.from(buckets.entries()).map(([day, revenue]) => ({ day, revenue }));
}

/** Today's payment mix aggregated across many branches — group rollup. */
export async function groupPaymentMixToday(branchIds: string[]) {
  const today = startOfDay();
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: { branchId: { in: branchIds }, placedAt: { gte: today }, status: PAID },
  });
  return rows.map((r) => ({ method: r.paymentMethod, count: r._count._all, revenue: Number(r._sum.total ?? 0) }));
}
