import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { Card, CardContent } from '@/components/ui/card';
import { salesSeries, bestSellers, leastSellers, riderPerformance, customerInsights } from '@/server/analytics';
import { ChartsClient } from '../charts-client';
import { money } from '@/lib/utils';
import { ReportRangePicker } from '@/app/_components/report-range-picker';

export const metadata = { title: 'Admin · Reports' };

const REPORTS = [
  { slug: 'daily-sales', title: 'Daily sales', description: 'Per-day orders, net sales, tax, delivery fee, and gross totals.' },
  { slug: 'item-sales', title: 'Item sales', description: 'SKU-level breakdown: itemId, name, qty sold, revenue.' },
  { slug: 'cancelled-orders', title: 'Cancelled orders', description: 'Order code, customer, reason, refunded amount.' },
  { slug: 'payment-mode', title: 'Payment mode', description: 'Count and total per payment method.' },
  { slug: 'taxes', title: 'Taxes', description: 'Daily tax collected for the chosen range.' },
  { slug: 'delivery-fees', title: 'Delivery fees', description: 'Daily delivery fee revenue and order counts.' }
];

export default async function ReportsPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  const [sales, bs, ls, rp, ci] = await Promise.all([
    salesSeries(branch.id, 30), bestSellers(branch.id, 10), leastSellers(branch.id, 5), riderPerformance(branch.id), customerInsights(branch.id)
  ]);

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Pick a date range, then download the report you need.</p>
      </header>

      <ReportRangePicker apiBase="/api/admin/reports" reports={REPORTS} />

      <Card><CardContent className="p-5"><h3 className="font-semibold mb-3">Sales (30 days)</h3><ChartsClient kind="sales" data={sales as any} /></CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Best sellers</h3>
          <ul className="text-sm divide-y">{bs.map((b) => <li key={b.name} className="flex justify-between py-2"><span>{b.name}</span><span>{b.qty}</span></li>)}</ul>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Least sellers</h3>
          <ul className="text-sm divide-y">{ls.map((b) => <li key={b.name} className="flex justify-between py-2"><span>{b.name}</span><span>{b.qty}</span></li>)}</ul>
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-3">Customer insights</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Customers" value={String(ci.customers)} />
          <Stat label="Repeat rate" value={`${ci.repeatRate}%`} />
          <Stat label="AOV" value={money(ci.avgOrderValue)} />
          <Stat label="Orders / customer" value={String(ci.avgOrdersPerCustomer)} />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-3">Rider performance (30d)</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2">Rider</th><th>Done</th><th>Failed</th><th>Avg min</th><th>Rating</th></tr>
          </thead>
          <tbody>
            {rp.map((r) => (
              <tr key={r.riderId} className="border-t"><td className="py-2">{r.name}</td><td>{r.completed}</td><td>{r.failed}</td><td>{r.avgDeliveryMin}</td><td>{r.rating.toFixed(1)}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold">{value}</div></div>;
}
