import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { OrdersExplorer } from './explorer';
import { money } from '@/lib/utils';
import { ScrollText, Wallet, Clock, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Platform · Orders' };
export const dynamic = 'force-dynamic';

export default async function PlatformOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; payment?: string; restaurantId?: string; period?: string }> }) {
  const sp = await searchParams;
  const status = sp.status || '';
  const payment = sp.payment || '';
  const restaurantId = sp.restaurantId || '';
  const q = sp.q || '';
  const period = sp.period || '30d';

  const since =
    period === '7d'  ? new Date(Date.now() - 7 * 86_400_000)
  : period === '30d' ? new Date(Date.now() - 30 * 86_400_000)
  : period === '90d' ? new Date(Date.now() - 90 * 86_400_000)
  : null;

  const where: any = {};
  if (status) where.status = status;
  if (payment) where.paymentMethod = payment;
  if (since) where.placedAt = { gte: since };
  if (restaurantId) where.branch = { restaurantId };
  if (q) {
    where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { customer: { phone: { contains: q } } },
      { customer: { name:  { contains: q, mode: 'insensitive' } } }
    ];
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const [orders, totalMatching, restaurants, paidAgg, todayAgg, yesterdayAgg, slaAgg] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      take: 300,
      include: {
        customer: { select: { name: true, phone: true } },
        branch: { include: { restaurant: { select: { name: true } } } },
        assignment: { include: { rider: { include: { user: { select: { name: true } } } } } }
      }
    }),
    prisma.order.count({ where }),
    prisma.restaurant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.order.aggregate({ where: { ...where, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] }, placedAt: { gte: today } }, _sum: { total: true }, _count: true }),
    prisma.order.aggregate({ where: { status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] }, placedAt: { gte: yesterday, lt: today } }, _sum: { total: true }, _count: true }),
    // Avg fulfillment time over the matching window for delivered orders
    prisma.order.findMany({
      where: { ...where, status: 'DELIVERED', placedAt: { not: undefined }, deliveredAt: { not: null } },
      select: { placedAt: true, deliveredAt: true },
      take: 500
    })
  ]);

  const todayGmv = Number(todayAgg._sum.total ?? 0);
  const yGmv     = Number(yesterdayAgg._sum.total ?? 0);
  const gmvDelta = yGmv === 0 ? (todayGmv > 0 ? 100 : 0) : ((todayGmv - yGmv) / yGmv) * 100;
  const matchingGmv = Number(paidAgg._sum.total ?? 0);
  const avgOrderValue = orders.length > 0
    ? +(orders.reduce((s, o) => s + Number(o.total), 0) / orders.length).toFixed(0)
    : 0;
  const avgFulfillMin = slaAgg.length === 0 ? 0
    : Math.round(slaAgg.reduce((s, o) => s + ((+o.deliveredAt!) - (+o.placedAt)) / 60_000, 0) / slaAgg.length);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">Every order across every restaurant. Filter, search, and drill in to inspect.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <SmallStat icon={ScrollText} label="Matching"  value={totalMatching.toLocaleString('en-IN')} sub={`shown: ${orders.length}`} />
        <SmallStat icon={Wallet}     label="GMV (paid)" value={money(matchingGmv)} sub={`AOV ${money(avgOrderValue)}`} />
        <SmallStat icon={Clock}      label="Avg fulfilment" value={avgFulfillMin ? `${avgFulfillMin} min` : '—'} sub="placed → delivered" />
        <SmallStat icon={AlertTriangle} label="Today vs yesterday" value={`${gmvDelta >= 0 ? '+' : ''}${gmvDelta.toFixed(1)}%`} sub={`${money(todayGmv)} today`} tone={gmvDelta >= 0 ? 'success' : 'destructive'} />
      </div>

      <OrdersExplorer
        initial={JSON.parse(JSON.stringify(orders))}
        restaurants={restaurants}
        filters={{ status, payment, restaurantId, q, period }}
      />
    </div>
  );
}

function SmallStat({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: 'success' | 'destructive' }) {
  const cls = tone === 'success' ? 'bg-success/10 text-success' : tone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary';
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-lg leading-tight">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
