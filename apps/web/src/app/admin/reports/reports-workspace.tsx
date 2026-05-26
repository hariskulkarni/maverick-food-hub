import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { Card, CardContent } from '@/components/ui/card';
import { salesSeries, bestSellers, leastSellers, riderPerformance, customerInsights } from '@/server/analytics';
import { ChartsClient } from '../charts-client';
import { money } from '@/lib/utils';
import { ReportRangePicker } from '@/app/_components/report-range-picker';
import { resolveGroupReport, groupSalesSeries, childBreakdownRange } from './_group-metrics';
import { Network, Info } from 'lucide-react';

/**
 * ReportsWorkspace — the full reporting surface: a custom date-range report
 * downloader (CSV) plus 30-day charts, best/least sellers, customer insights
 * and rider performance, with automatic group rollup for parent restaurants.
 *
 * Extracted so it is the SINGLE source of truth shared by both the canonical
 * `/admin/reports` page and the Storefront CMS hub's Reports tab.
 */

export const REPORTS = [
  { slug: 'daily-sales', title: 'Daily sales', description: 'Per-day orders, net sales, tax, delivery fee, and gross totals.' },
  { slug: 'item-sales', title: 'Item sales', description: 'SKU-level breakdown: itemId, name, qty sold, revenue.' },
  { slug: 'cancelled-orders', title: 'Cancelled orders', description: 'Order code, customer, reason, refunded amount.' },
  { slug: 'payment-mode', title: 'Payment mode', description: 'Count and total per payment method.' },
  { slug: 'taxes', title: 'Taxes', description: 'Daily tax collected for the chosen range.' },
  { slug: 'delivery-fees', title: 'Delivery fees', description: 'Daily delivery fee revenue and order counts.' },
];

export async function ReportsWorkspace({ showHeader = true }: { showHeader?: boolean }) {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });

  // Group scope: roll the sales chart + per-restaurant breakdown up across the
  // group when this is a parent with rollup enabled; otherwise stay single-branch.
  const report = await resolveGroupReport(restaurant.id, branch.id);

  const [sales, bs, ls, rp, ci, breakdown] = await Promise.all([
    report.rollup ? groupSalesSeries(report.branchIds, 30) : salesSeries(branch.id, 30),
    bestSellers(branch.id, 10), leastSellers(branch.id, 5), riderPerformance(branch.id), customerInsights(branch.id),
    report.rollup ? childBreakdownRange(report.ctx, 30) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      {showHeader && (
        <header>
          <h1 className="display text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Pick a date range, then download the report you need.
            {report.rollup && (
              <span className="ml-1 inline-flex items-center gap-1 text-primary">
                <Network className="size-3.5" /> Rolled up across your group ({report.ctx.restaurants.length} restaurants).
              </span>
            )}
          </p>
        </header>
      )}

      {report.rollupAvailableButOff && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="size-4 mt-0.5 shrink-0 text-primary" />
          <span>
            This restaurant heads a group of {report.ctx.restaurants.length} restaurants. Reports show only its own
            data — enable <span className="font-medium">group report sharing</span> to roll up every child.
          </span>
        </div>
      )}

      <ReportRangePicker apiBase="/api/admin/reports" reports={REPORTS} />

      <Card><CardContent className="p-5"><h3 className="font-semibold mb-3">Sales (30 days){report.rollup ? ' · group' : ''}</h3><ChartsClient kind="sales" data={sales as any} /></CardContent></Card>

      {report.rollup && breakdown.length > 0 && (
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Network className="size-4" /> By restaurant (30 days)</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-2">Restaurant</th><th className="text-right">Orders</th><th className="text-right">Revenue</th></tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.restaurantId} className="border-t">
                  <td className="py-2">
                    {row.restaurantName}
                    {row.isParent && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Parent</span>}
                  </td>
                  <td className="text-right tabular-nums">{row.orders}</td>
                  <td className="text-right tabular-nums font-medium">{money(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-2">Group total</td>
                <td className="text-right tabular-nums">{breakdown.reduce((s, r) => s + r.orders, 0)}</td>
                <td className="text-right tabular-nums">{money(breakdown.reduce((s, r) => s + r.revenue, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent></Card>
      )}

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
