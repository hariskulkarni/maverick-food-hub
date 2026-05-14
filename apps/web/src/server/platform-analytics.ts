/**
 * Platform-wide analytics for super-admin.
 * All queries are cross-tenant; only SUPER_ADMIN reaches these functions.
 */
import { prisma } from './db';

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

export async function platformKpis() {
  const since30 = daysAgo(30);
  const [restaurants, pending, customers, riders, online, orders30, gmv30Agg, todayOrders, todayGmvAgg] = await Promise.all([
    prisma.restaurant.count(),
    prisma.restaurant.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.riderProfile.count(),
    prisma.riderProfile.count({ where: { isOnline: true } }),
    prisma.order.count({ where: { placedAt: { gte: since30 }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { placedAt: { gte: since30 }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } } }),
    prisma.order.count({ where: { placedAt: { gte: new Date(new Date().setHours(0,0,0,0)) }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { placedAt: { gte: new Date(new Date().setHours(0,0,0,0)) }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } } })
  ]);
  return {
    restaurants, pending, customers, riders, online,
    orders30,
    gmv30: Number(gmv30Agg._sum.total ?? 0),
    todayOrders,
    todayGmv: Number(todayGmvAgg._sum.total ?? 0)
  };
}

export async function gmvSeries(days = 30) {
  const since = daysAgo(days);
  const rows = await prisma.order.findMany({
    where: { placedAt: { gte: since }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } },
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
  return Array.from(buckets.entries()).map(([day, gmv]) => ({ day, gmv }));
}

export async function topRestaurants(limit = 10) {
  const since = daysAgo(30);
  const grouped = await prisma.order.groupBy({
    by: ['branchId'],
    _sum: { total: true },
    _count: { _all: true },
    where: { placedAt: { gte: since }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } },
    orderBy: { _sum: { total: 'desc' } },
    take: limit
  });
  const branchIds = grouped.map((g) => g.branchId);
  const branches = await prisma.branch.findMany({ where: { id: { in: branchIds } }, include: { restaurant: true } });
  return grouped.map((g) => {
    const b = branches.find((x) => x.id === g.branchId);
    return {
      restaurantId: b?.restaurantId ?? null,
      name: b?.restaurant.name ?? '—',
      orders: g._count._all,
      gmv: Number(g._sum.total ?? 0)
    };
  });
}

export async function topProducts(limit = 10) {
  const since = daysAgo(30);
  const rows = await prisma.orderItem.groupBy({
    by: ['name'],
    _sum: { quantity: true },
    where: { order: { placedAt: { gte: since }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } } },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit
  });
  return rows.map((r) => ({ name: r.name, qty: r._sum.quantity ?? 0 }));
}

export async function peakHours() {
  const since = daysAgo(14);
  const rows = await prisma.order.findMany({ where: { placedAt: { gte: since } }, select: { placedAt: true } });
  const buckets = new Array(24).fill(0);
  for (const r of rows) buckets[new Date(r.placedAt).getHours()]++;
  return buckets.map((count, hour) => ({ hour, count }));
}

export async function paymentSplit() {
  const since = daysAgo(30);
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: { placedAt: { gte: since }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } }
  });
  return rows.map((r) => ({ method: r.paymentMethod, count: r._count._all, gmv: Number(r._sum.total ?? 0) }));
}

export async function riderLeaderboard(limit = 10) {
  return prisma.riderProfile.findMany({
    orderBy: [{ totalEarnings: 'desc' }],
    take: limit,
    include: { user: true }
  }).then((rows) => rows.map((r) => ({
    name: r.user.name ?? r.user.phone ?? r.id,
    deliveries: r.totalDeliveries,
    earnings: Number(r.totalEarnings),
    tips: Number(r.totalTips),
    rating: r.rating
  })));
}

export async function spendDistribution() {
  // Bucketize order totals to a histogram
  const since = daysAgo(30);
  const rows = await prisma.order.findMany({
    where: { placedAt: { gte: since }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } },
    select: { total: true }
  });
  const buckets = [
    { label: '< ₹200', max: 200, count: 0 },
    { label: '₹200–₹400', max: 400, count: 0 },
    { label: '₹400–₹600', max: 600, count: 0 },
    { label: '₹600–₹1000', max: 1000, count: 0 },
    { label: '₹1000+', max: Infinity, count: 0 }
  ];
  for (const r of rows) {
    const t = Number(r.total);
    for (const b of buckets) { if (t < b.max) { b.count++; break; } }
  }
  return buckets;
}
