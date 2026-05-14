import Link from 'next/link';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { dashboardKpis, salesSeries, bestSellers, peakHours, paymentMixToday, customerInsights } from '@/server/analytics';
import { money } from '@/lib/utils';
import { ChartsClient } from './charts-client';
import { ArrowRight, ScrollText, Truck, Wallet, Users, History } from 'lucide-react';
import { requireRestaurant } from '@/server/tenancy';

export const metadata = { title: 'Admin · Dashboard' };

export default async function AdminDashboardPage() {
  const session = await auth();
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  const [kpi, sales, sellers, peak, mix, ci, latest, recentActivity] = await Promise.all([
    dashboardKpis(branch.id),
    salesSeries(branch.id, 14),
    bestSellers(branch.id, 6),
    peakHours(branch.id),
    paymentMixToday(branch.id),
    customerInsights(branch.id),
    prisma.order.findMany({ where: { branchId: branch.id }, orderBy: { placedAt: 'desc' }, take: 6, include: { customer: true } }),
    prisma.auditLog.findMany({
      where: {
        restaurantId: restaurant.id,
        OR: [
          { action: { startsWith: 'menu.' } },
          { action: { startsWith: 'integration.' } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    })
  ]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="display text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {session?.user.name?.split(' ')[0]}.</p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi title="Orders today" icon={ScrollText} value={String(kpi.todayOrders)} />
        <Kpi title="Revenue today" icon={Wallet} value={money(kpi.todayRevenue)} />
        <Kpi title="Pending" icon={ScrollText} value={String(kpi.pending)} hint={kpi.pending > 0 ? 'Action required' : 'All caught up'} />
        <Kpi title="Out for delivery" icon={Truck} value={String(kpi.activeDeliveries)} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2"><CardContent className="p-5">
          <h3 className="font-semibold mb-4">Revenue, last 14 days</h3>
          <ChartsClient kind="sales" data={sales as any} />
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-4">Payment mix (today)</h3>
          <ChartsClient kind="paymix" data={mix as any} />
        </CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-4">Best sellers</h3>
          <ChartsClient kind="sellers" data={sellers as any} />
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-4">Peak hours</h3>
          <ChartsClient kind="peak" data={peak as any} />
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Users className="size-4" /> Customers</h3>
          <Stat label="Customers" value={String(ci.customers)} />
          <Stat label="Repeat rate" value={`${ci.repeatRate}%`} />
          <Stat label="Avg order value" value={money(ci.avgOrderValue)} />
          <Stat label="Avg orders / customer" value={String(ci.avgOrdersPerCustomer)} />
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><History className="size-4" /> Recent menu changes</h3>
          <Link className="text-sm text-primary hover:underline flex items-center gap-1" href="/admin/activity">View all <ArrowRight className="size-3" /></Link>
        </div>
        {recentActivity.length === 0 ? (
          <div className="text-sm text-muted-foreground">No recent menu or integration changes.</div>
        ) : (
          <ul className="divide-y text-sm">
            {recentActivity.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs text-muted-foreground">{row.action}</span>
                <span className="text-muted-foreground">{relativeTimeShort(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Latest orders</h3>
          <Link className="text-sm text-primary hover:underline flex items-center gap-1" href="/admin/orders">All orders <ArrowRight className="size-3" /></Link>
        </div>
        <ul className="divide-y text-sm">
          {latest.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <Link href={`/admin/orders/${o.id}`} className="hover:text-primary"><span className="font-medium">{o.code}</span> · {o.status}</Link>
              <span className="text-muted-foreground">{o.customer.name ?? o.customer.phone}</span>
              <span className="font-semibold">{money(o.total as any)}</span>
            </li>
          ))}
        </ul>
      </CardContent></Card>
    </div>
  );
}

function Kpi({ title, value, hint, icon: Icon }: { title: string; value: string; hint?: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="display text-2xl font-semibold mt-1">{value}</div>
            {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
          </div>
          <div className="size-10 grid place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between py-1 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}

function relativeTimeShort(d: Date): string {
  const sec = Math.max(1, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
