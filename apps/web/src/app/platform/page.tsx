import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KpiCard } from '@/components/admin/kpi-card';
import { Sparkline } from '@/components/admin/sparkline';
import {
  Building2, Users, ScrollText, Wallet, Bike, AlertTriangle, Sparkles, ArrowRight,
  TrendingUp, Trophy, Activity, ChefHat, MapPin
} from 'lucide-react';
import { money } from '@/lib/utils';

export const metadata = { title: 'Platform · Dashboard' };
export const dynamic = 'force-dynamic';

function dayStart(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }

export default async function PlatformDashboard() {
  const now = new Date();
  const today = dayStart(now);
  const yesterday = dayStart(daysAgo(1));
  const sevenDaysAgo = dayStart(daysAgo(7));
  const fourteenDaysAgo = dayStart(daysAgo(14));
  const thirtyDaysAgo = dayStart(daysAgo(30));

  const PAID = { status: { notIn: ['CANCELLED' as const, 'PAYMENT_FAILED' as const] } };

  const [
    restaurants, pendingRestaurants, suspendedRestaurants,
    totalOrders,
    paidAggLifetime,
    paidAggThisWeek, paidAggLastWeek,
    ordersThisWeek, ordersLastWeek,
    customersThisWeek, customersLastWeek,
    ridersOnline, totalRiders, ridersWithPendingApp,
    totalCustomers,
    latestOrders,
    last30Orders,
    topRestaurants30d,
    topRiders30d,
    statusMix
  ] = await Promise.all([
    prisma.restaurant.count(),
    prisma.restaurant.count({ where: { status: 'PENDING' } }),
    prisma.restaurant.count({ where: { status: 'SUSPENDED' } }),
    prisma.order.count(),
    prisma.order.aggregate({ _sum: { total: true }, where: PAID }),
    prisma.order.aggregate({ _sum: { total: true }, _count: true, where: { ...PAID, placedAt: { gte: sevenDaysAgo } } }),
    prisma.order.aggregate({ _sum: { total: true }, _count: true, where: { ...PAID, placedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
    prisma.order.count({ where: { placedAt: { gte: sevenDaysAgo } } }),
    prisma.order.count({ where: { placedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
    prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: sevenDaysAgo } } }),
    prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
    prisma.riderProfile.count({ where: { isOnline: true } }),
    prisma.riderProfile.count({}),
    prisma.riderApplication.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.findMany({
      orderBy: { placedAt: 'desc' },
      take: 12,
      include: { customer: true, branch: { include: { restaurant: { select: { name: true, logoUrl: true } } } } }
    }),
    // 30-day window grouped per-day for sparkline. Pulling raw rows is cheap at our volumes.
    prisma.order.findMany({
      where: { ...PAID, placedAt: { gte: thirtyDaysAgo } },
      select: { placedAt: true, total: true }
    }),
    prisma.order.groupBy({
      by: ['branchId'],
      where: { ...PAID, placedAt: { gte: thirtyDaysAgo } },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: 'desc' } },
      take: 5
    }),
    prisma.riderAssignment.groupBy({
      by: ['riderId'],
      where: { status: 'DELIVERED', deliveredAt: { gte: thirtyDaysAgo } },
      _sum: { earningsAmt: true, tipAmt: true },
      _count: true,
      orderBy: { _sum: { earningsAmt: 'desc' } },
      take: 5
    }),
    prisma.order.groupBy({
      by: ['status'],
      where: { placedAt: { gte: thirtyDaysAgo } },
      _count: true
    })
  ]);

  // ── Derive: daily GMV/orders for last 30 days
  const dailyGmv: number[] = Array.from({ length: 30 }, () => 0);
  const dailyOrders: number[] = Array.from({ length: 30 }, () => 0);
  for (const o of last30Orders) {
    const dayIdx = Math.min(29, Math.max(0, Math.floor((+o.placedAt - +thirtyDaysAgo) / 86_400_000)));
    dailyGmv[dayIdx] += Number(o.total);
    dailyOrders[dayIdx] += 1;
  }
  const dailyCustomers: number[] = Array.from({ length: 30 }, () => 0); // we don't easily have per-day user signups; use orders as a proxy for activity

  // ── Top restaurants — hydrate names/logos
  const branchIds = topRestaurants30d.map((r) => r.branchId);
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    include: { restaurant: { select: { name: true, logoUrl: true, slug: true } } }
  });
  const topRestaurantRows = topRestaurants30d.map((r) => {
    const b = branches.find((x) => x.id === r.branchId);
    return {
      branchId: r.branchId,
      restaurantName: b?.restaurant.name ?? 'Unknown',
      restaurantSlug: b?.restaurant.slug,
      logoUrl: b?.restaurant.logoUrl,
      gmv: Number(r._sum.total ?? 0),
      orders: r._count
    };
  });

  // ── Top riders — hydrate names
  const riderIds = topRiders30d.map((r) => r.riderId);
  const riderProfiles = await prisma.riderProfile.findMany({
    where: { id: { in: riderIds } },
    include: { user: { select: { name: true, phone: true } } }
  });
  const topRiderRows = topRiders30d.map((r) => {
    const p = riderProfiles.find((x) => x.id === r.riderId);
    return {
      riderId: r.riderId,
      name: p?.user?.name ?? p?.user?.phone ?? 'Unknown',
      earnings: Number(r._sum.earningsAmt ?? 0),
      tips: Number(r._sum.tipAmt ?? 0),
      trips: r._count
    };
  });

  // ── Status mix
  const statusOrder = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
  const statusCounts = statusOrder.map((s) => ({ status: s, count: statusMix.find((m) => m.status === s)?._count ?? 0 }));
  const totalStatus = statusCounts.reduce((s, x) => s + x.count, 0);

  // ── Deltas vs last week
  const gmvThis = Number(paidAggThisWeek._sum.total ?? 0);
  const gmvLast = Number(paidAggLastWeek._sum.total ?? 0);
  const gmvDelta = gmvLast === 0 ? (gmvThis > 0 ? 100 : 0) : ((gmvThis - gmvLast) / gmvLast) * 100;
  const ordersDelta = ordersLastWeek === 0 ? (ordersThisWeek > 0 ? 100 : 0) : ((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100;
  const customersDelta = customersLastWeek === 0 ? (customersThisWeek > 0 ? 100 : 0) : ((customersThisWeek - customersLastWeek) / customersLastWeek) * 100;

  const trendFor = (delta: number) => delta > 1 ? 'up' as const : delta < -1 ? 'down' as const : 'flat' as const;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3 reveal">
        <div>
          <h1 className="display text-3xl font-semibold">Platform overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time GMV, growth deltas, and the queue of work that needs you.</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })}</div>
          <div className="mt-0.5 font-medium">All times IST</div>
        </div>
      </header>

      {/* Alerts band */}
      {(pendingRestaurants > 0 || ridersWithPendingApp > 0 || suspendedRestaurants > 0) && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap reveal">
            <AlertTriangle className="size-5 text-warning shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <strong>You have work waiting.</strong>
              {pendingRestaurants > 0 && <> <Link href="/platform/restaurants?status=PENDING" className="text-primary font-medium hover:underline">{pendingRestaurants} restaurant{pendingRestaurants === 1 ? '' : 's'} pending approval</Link>.</>}
              {ridersWithPendingApp > 0 && <> <Link href="/platform/riders" className="text-primary font-medium hover:underline">{ridersWithPendingApp} rider application{ridersWithPendingApp === 1 ? '' : 's'}</Link>.</>}
              {suspendedRestaurants > 0 && <> <Link href="/platform/restaurants?status=SUSPENDED" className="text-primary font-medium hover:underline">{suspendedRestaurants} suspended restaurant{suspendedRestaurants === 1 ? '' : 's'}</Link>.</>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 reveal-stagger">
        <KpiCard
          title="GMV · 7 days"
          value={money(gmvThis)}
          icon={Wallet}
          trend={trendFor(gmvDelta)}
          deltaPct={gmvDelta}
          sparkline={dailyGmv.slice(-14)}
          accentColor="primary"
        />
        <KpiCard
          title="Orders · 7 days"
          value={ordersThisWeek.toLocaleString('en-IN')}
          icon={ScrollText}
          trend={trendFor(ordersDelta)}
          deltaPct={ordersDelta}
          sparkline={dailyOrders.slice(-14)}
          accentColor="success"
        />
        <KpiCard
          title="New customers · 7d"
          value={customersThisWeek.toLocaleString('en-IN')}
          icon={Users}
          trend={trendFor(customersDelta)}
          deltaPct={customersDelta}
          accentColor="warning"
        />
        <KpiCard
          title="Riders online"
          value={`${ridersOnline}/${totalRiders}`}
          icon={Bike}
          accentColor="success"
          href="/platform/live"
        />
      </div>

      {/* Lifetime + 30d strip */}
      <div className="grid gap-4 md:grid-cols-4 reveal-stagger">
        <SmallStat icon={Building2}  label="Total restaurants" value={restaurants.toLocaleString('en-IN')} sub={`${pendingRestaurants} pending · ${suspendedRestaurants} suspended`} href="/platform/restaurants" />
        <SmallStat icon={Users}      label="Total customers"   value={totalCustomers.toLocaleString('en-IN')} sub="all-time signups" href="/platform/users?role=CUSTOMER" />
        <SmallStat icon={ScrollText} label="Lifetime orders"   value={totalOrders.toLocaleString('en-IN')} sub={`avg ${totalOrders > 0 ? Math.round(totalOrders / Math.max(1, restaurants)) : 0} per restaurant`} href="/platform/orders" />
        <SmallStat icon={Wallet}     label="GMV · lifetime"    value={money(Number(paidAggLifetime._sum.total ?? 0))} sub="captured payments" />
      </div>

      {/* Body grid */}
      <div className="grid gap-6 lg:grid-cols-3 reveal-stagger">
        {/* 30-day revenue chart */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> Revenue · last 30 days</h3>
                <p className="text-xs text-muted-foreground">Captured GMV, by day. Hover the trail to compare with last week.</p>
              </div>
              <Link href="/platform/analytics" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Deep analytics <ArrowRight className="size-3" /></Link>
            </div>
            <div className="w-full h-40">
              <Sparkline data={dailyGmv} width={800} height={160} className="w-full h-full" />
            </div>
            <div className="mt-3 grid grid-cols-3 text-xs text-muted-foreground">
              <div>Min ₹{Math.round(Math.min(...dailyGmv)).toLocaleString('en-IN')}</div>
              <div className="text-center">Avg ₹{Math.round(dailyGmv.reduce((s, x) => s + x, 0) / 30).toLocaleString('en-IN')}/day</div>
              <div className="text-right">Peak ₹{Math.round(Math.max(...dailyGmv)).toLocaleString('en-IN')}</div>
            </div>
          </CardContent>
        </Card>

        {/* Order status mix */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-3"><Activity className="size-4 text-primary" /> 30-day status mix</h3>
            <ul className="space-y-2">
              {statusCounts.map((s) => {
                const pct = totalStatus === 0 ? 0 : (s.count / totalStatus) * 100;
                const bar = statusColor(s.status);
                return (
                  <li key={s.status}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-medium">{statusLabel(s.status)}</span>
                      <span className="text-muted-foreground">{s.count} · {pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
              {totalStatus === 0 && <li className="text-xs text-muted-foreground text-center py-4">No orders in the last 30 days.</li>}
            </ul>
          </CardContent>
        </Card>

        {/* Top restaurants leaderboard */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Trophy className="size-4 text-warning" /> Top restaurants · 30d</h3>
              <Link href="/platform/restaurants" className="text-xs text-primary hover:underline">All restaurants →</Link>
            </div>
            <div className="space-y-2">
              {topRestaurantRows.map((r, i) => (
                <Link key={r.branchId} href={r.restaurantSlug ? `/r/${r.restaurantSlug}` : '#'} className="block">
                  <div className="rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors p-3 flex items-center gap-3">
                    <div className="grid size-8 place-items-center rounded-full bg-warning/10 text-warning font-bold text-sm shrink-0">{i + 1}</div>
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {r.logoUrl && <Image src={r.logoUrl} alt="" fill sizes="40px" className="object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.restaurantName}</div>
                      <div className="text-xs text-muted-foreground">{r.orders.toLocaleString('en-IN')} orders</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{money(r.gmv)}</div>
                      <div className="text-[10px] text-muted-foreground">GMV</div>
                    </div>
                  </div>
                </Link>
              ))}
              {topRestaurantRows.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No paid orders yet.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Top riders leaderboard */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Sparkles className="size-4 text-success" /> Top riders · 30d</h3>
              <Link href="/platform/riders" className="text-xs text-primary hover:underline">All →</Link>
            </div>
            <div className="space-y-2">
              {topRiderRows.map((r, i) => (
                <div key={r.riderId} className="rounded-lg border bg-card p-3 flex items-center gap-3">
                  <div className="grid size-8 place-items-center rounded-full bg-success/15 text-success font-bold text-sm shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.trips} trips · {money(r.tips)} tips</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success text-sm">{money(r.earnings)}</div>
                  </div>
                </div>
              ))}
              {topRiderRows.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No deliveries yet.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Live activity feed */}
        <Card className="lg:col-span-3">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="relative inline-flex">
                  <span className="size-2 rounded-full bg-success" />
                  <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />
                </span>
                Live activity
              </h3>
              <Link href="/platform/orders" className="text-xs text-primary hover:underline">All orders →</Link>
            </div>
            <ul className="divide-y">
              {latestOrders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="relative size-7 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {o.branch.restaurant.logoUrl && <Image src={o.branch.restaurant.logoUrl} alt="" fill sizes="28px" className="object-cover" />}
                  </div>
                  <span className="font-mono text-xs">{o.code}</span>
                  <span className="text-muted-foreground hidden sm:inline truncate flex-1">
                    {o.branch.restaurant.name} · {o.customer.name ?? o.customer.phone ?? 'guest'}
                  </span>
                  <span className="ml-auto sm:ml-0"><StatusPill status={o.status} /></span>
                  <span className="font-semibold w-20 text-right">{money(o.total as any)}</span>
                  <span className="text-[10px] text-muted-foreground w-16 text-right">{timeAgo(o.placedAt)}</span>
                </li>
              ))}
              {latestOrders.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No orders yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SmallStat({ icon: Icon, label, value, sub, href }: { icon: any; label: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <CardContent className="p-4 flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-lg bg-muted shrink-0"><Icon className="size-5 text-muted-foreground" /></div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className="font-bold text-lg leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
      </div>
    </CardContent>
  );
  return href ? <a href={href}><Card className="hover:border-primary/40 transition-colors">{inner}</Card></a> : <Card>{inner}</Card>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DELIVERED: 'bg-success/15 text-success border-success/30',
    OUT_FOR_DELIVERY: 'bg-primary/15 text-primary border-primary/30',
    READY: 'bg-warning/15 text-warning border-warning/30',
    PREPARING: 'bg-warning/15 text-warning border-warning/30',
    ACCEPTED: 'bg-primary/15 text-primary border-primary/30',
    RECEIVED: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-destructive/15 text-destructive border-destructive/30',
    REFUND_INITIATED: 'bg-destructive/15 text-destructive border-destructive/30',
    REFUNDED: 'bg-destructive/15 text-destructive border-destructive/30'
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status] ?? 'bg-muted'}`}>{statusLabel(status)}</span>;
}

function statusLabel(s: string) {
  return { RECEIVED: 'Placed', ACCEPTED: 'Accepted', PREPARING: 'Cooking', READY: 'Ready', OUT_FOR_DELIVERY: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REFUND_INITIATED: 'Refunding', REFUNDED: 'Refunded' }[s] ?? s;
}

function statusColor(s: string) {
  return s === 'DELIVERED' ? 'bg-success'
    : s === 'CANCELLED' ? 'bg-destructive'
    : s === 'REFUNDED' || s === 'REFUND_INITIATED' ? 'bg-destructive'
    : s === 'OUT_FOR_DELIVERY' || s === 'ACCEPTED' ? 'bg-primary'
    : 'bg-warning';
}

function timeAgo(d: Date | string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
