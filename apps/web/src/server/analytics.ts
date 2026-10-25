import { prisma } from './db';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { REVENUE_STATUS_FILTER } from './reports/revenue';
import { istStartOfDay, istEndOfDay, istDayKey, istHour, lastIstDayKeys } from '@/lib/ist';

// Day boundaries are IST (restaurants run on IST; the server may not) — P1-8.
const start = (d = new Date()) => istStartOfDay(d);
const end = (d = new Date()) => istEndOfDay(d);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

/** Every metric accepts one branch or many (all of a restaurant's branches — P1-9). */
type Branches = string | string[];
const inBranches = (b: Branches) => (Array.isArray(b) ? { in: b } : b);

export async function dashboardKpis(branches: Branches) {
  const branchId = inBranches(branches);
  const today = start();
  const todayEnd = end();
  const [todayOrders, todayPaid, pending, activeDeliveries] = await Promise.all([
    // "Orders today" counts real orders only (same include-list as revenue).
    prisma.order.count({ where: { branchId, placedAt: { gte: today, lte: todayEnd }, status: REVENUE_STATUS_FILTER } }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { branchId, placedAt: { gte: today, lte: todayEnd }, status: REVENUE_STATUS_FILTER }
    }),
    prisma.order.count({ where: { branchId, status: { in: [OrderStatus.RECEIVED] } } }),
    prisma.order.count({ where: { branchId, status: OrderStatus.OUT_FOR_DELIVERY } })
  ]);
  return {
    todayOrders,
    todayRevenue: Number(todayPaid._sum.total ?? 0),
    pending,
    activeDeliveries
  };
}

export async function salesSeries(branches: Branches, days = 14) {
  const keys = lastIstDayKeys(days);
  const rows = await prisma.order.findMany({
    where: { branchId: inBranches(branches), placedAt: { gte: istStartOfDay(keys[0]) }, status: REVENUE_STATUS_FILTER },
    select: { placedAt: true, total: true }
  });
  const buckets = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = istDayKey(r.placedAt);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(r.total));
  }
  return Array.from(buckets.entries()).map(([day, revenue]) => ({ day, revenue }));
}

export async function bestSellers(branches: Branches, limit = 8) {
  const branchId = inBranches(branches);
  const rows = await prisma.orderItem.groupBy({
    by: ['name'],
    _sum: { quantity: true },
    where: { order: { branchId, status: REVENUE_STATUS_FILTER } },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit
  });
  return rows.map((r) => ({ name: r.name, qty: r._sum.quantity ?? 0 }));
}

export async function leastSellers(branches: Branches, limit = 8) {
  const branchId = inBranches(branches);
  const rows = await prisma.orderItem.groupBy({
    by: ['name'],
    _sum: { quantity: true },
    where: { order: { branchId, status: REVENUE_STATUS_FILTER } },
    orderBy: { _sum: { quantity: 'asc' } },
    take: limit
  });
  return rows.map((r) => ({ name: r.name, qty: r._sum.quantity ?? 0 }));
}

export async function paymentMixToday(branches: Branches) {
  const branchId = inBranches(branches);
  const today = start();
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: { branchId, placedAt: { gte: today }, status: REVENUE_STATUS_FILTER }
  });
  return rows.map((r) => ({ method: r.paymentMethod, count: r._count._all, revenue: Number(r._sum.total ?? 0) }));
}

export async function peakHours(branches: Branches) {
  const branchId = inBranches(branches);
  const rows = await prisma.order.findMany({
    where: { branchId, placedAt: { gte: daysAgo(14) }, status: REVENUE_STATUS_FILTER },
    select: { placedAt: true }
  });
  const buckets = new Array(24).fill(0);
  for (const r of rows) buckets[istHour(new Date(r.placedAt))]++;
  return buckets.map((count, hour) => ({ hour, count }));
}

export async function riderPerformance(branches: Branches) {
  const branchId = inBranches(branches);
  const since = daysAgo(30);
  const data = await prisma.riderProfile.findMany({
    where: { branchId },
    include: {
      user: true,
      assignments: {
        where: { assignedAt: { gte: since } },
        include: { order: { select: { deliveredAt: true, outForDeliveryAt: true } } }
      }
    }
  });
  return data.map((r) => {
    const completed = r.assignments.filter((a) => a.status === 'DELIVERED');
    const failed = r.assignments.filter((a) => a.status === 'REJECTED' || a.status === 'CANCELLED');
    const avgMin = completed.length
      ? completed.reduce((s, a) => {
          const t = a.deliveredAt && a.order.outForDeliveryAt ? (a.deliveredAt.getTime() - a.order.outForDeliveryAt.getTime()) / 60000 : 0;
          return s + t;
        }, 0) / completed.length
      : 0;
    return {
      riderId: r.id,
      name: r.user.name ?? r.user.phone ?? r.id,
      completed: completed.length,
      failed: failed.length,
      avgDeliveryMin: Math.round(avgMin),
      rating: r.rating
    };
  });
}

export async function customerInsights(branches: Branches) {
  const branchId = inBranches(branches);
  const rows = await prisma.order.groupBy({
    by: ['customerId'],
    _count: { _all: true },
    _sum: { total: true },
    where: { branchId, status: REVENUE_STATUS_FILTER }
  });
  const totalOrders = rows.reduce((s, r) => s + r._count._all, 0);
  const repeatRate = rows.length ? rows.filter((r) => r._count._all > 1).length / rows.length : 0;
  const aov = totalOrders ? rows.reduce((s, r) => s + Number(r._sum.total ?? 0), 0) / totalOrders : 0;
  const avgFreq = rows.length ? totalOrders / rows.length : 0;
  return {
    customers: rows.length,
    repeatRate: Math.round(repeatRate * 100),
    avgOrderValue: Math.round(aov),
    avgOrdersPerCustomer: +avgFreq.toFixed(2)
  };
}
