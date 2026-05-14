import { prisma } from './db';
import { OrderStatus, PaymentMethod } from '@prisma/client';

const start = (d = new Date()) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const end = (d = new Date()) => { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; };
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

export async function dashboardKpis(branchId: string) {
  const today = start();
  const todayEnd = end();
  const [todayOrders, todayPaid, pending, activeDeliveries] = await Promise.all([
    prisma.order.count({ where: { branchId, placedAt: { gte: today, lte: todayEnd } } }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { branchId, placedAt: { gte: today, lte: todayEnd }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED] } }
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

export async function salesSeries(branchId: string, days = 14) {
  const since = daysAgo(days);
  const rows = await prisma.order.findMany({
    where: { branchId, placedAt: { gte: since }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED] } },
    select: { placedAt: true, total: true }
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - (days - 1 - i)); d.setHours(0, 0, 0, 0);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const k = r.placedAt.toISOString().slice(0, 10);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + Number(r.total));
  }
  return Array.from(buckets.entries()).map(([day, revenue]) => ({ day, revenue }));
}

export async function bestSellers(branchId: string, limit = 8) {
  const rows = await prisma.orderItem.groupBy({
    by: ['name'],
    _sum: { quantity: true },
    where: { order: { branchId, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED] } } },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit
  });
  return rows.map((r) => ({ name: r.name, qty: r._sum.quantity ?? 0 }));
}

export async function leastSellers(branchId: string, limit = 8) {
  const rows = await prisma.orderItem.groupBy({
    by: ['name'],
    _sum: { quantity: true },
    where: { order: { branchId } },
    orderBy: { _sum: { quantity: 'asc' } },
    take: limit
  });
  return rows.map((r) => ({ name: r.name, qty: r._sum.quantity ?? 0 }));
}

export async function paymentMixToday(branchId: string) {
  const today = start();
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: { branchId, placedAt: { gte: today } }
  });
  return rows.map((r) => ({ method: r.paymentMethod, count: r._count._all, revenue: Number(r._sum.total ?? 0) }));
}

export async function peakHours(branchId: string) {
  const rows = await prisma.order.findMany({
    where: { branchId, placedAt: { gte: daysAgo(14) } },
    select: { placedAt: true }
  });
  const buckets = new Array(24).fill(0);
  for (const r of rows) buckets[new Date(r.placedAt).getHours()]++;
  return buckets.map((count, hour) => ({ hour, count }));
}

export async function riderPerformance(branchId: string) {
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

export async function customerInsights(branchId: string) {
  const rows = await prisma.order.groupBy({
    by: ['customerId'],
    _count: { _all: true },
    _sum: { total: true },
    where: { branchId, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED] } }
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
