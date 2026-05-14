import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import {
  platformKpis, gmvSeries, topRestaurants, topProducts, peakHours, paymentSplit, riderLeaderboard, spendDistribution
} from '@/server/platform-analytics';
import { AnalyticsCharts } from './charts';

export const metadata = { title: 'Platform · Deep analytics' };

export default async function PlatformAnalyticsPage() {
  const [kpi, series, restaurants, products, peaks, mix, riders, dist] = await Promise.all([
    platformKpis(), gmvSeries(30), topRestaurants(10), topProducts(10), peakHours(), paymentSplit(), riderLeaderboard(10), spendDistribution()
  ]);
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Deep analytics</h1>
        <p className="text-sm text-muted-foreground">Last 30 days · cross-restaurant + per-tenant drill-downs.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        <Kpi title="GMV (30d)" value={money(kpi.gmv30)} sub={`${kpi.orders30} orders`} />
        <Kpi title="Today's GMV" value={money(kpi.todayGmv)} sub={`${kpi.todayOrders} orders`} />
        <Kpi title="Restaurants" value={String(kpi.restaurants)} sub={`${kpi.pending} pending`} />
        <Kpi title="Customers" value={String(kpi.customers)} />
        <Kpi title="Riders online" value={`${kpi.online} / ${kpi.riders}`} />
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-3">GMV — last 30 days</h3>
        <AnalyticsCharts kind="gmv" data={series} />
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Top restaurants by GMV (30d)</h3>
          <ul className="text-sm divide-y">
            {restaurants.map((r) => (
              <li key={r.restaurantId || r.name} className="flex justify-between py-2">
                <span className="truncate">{r.name}</span>
                <span className="text-muted-foreground">{r.orders} orders</span>
                <span className="font-semibold w-28 text-right">{money(r.gmv)}</span>
              </li>
            ))}
            {restaurants.length === 0 && <li className="py-4 text-center text-muted-foreground">No data yet.</li>}
          </ul>
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Top products (30d)</h3>
          <ul className="text-sm divide-y">
            {products.map((p) => (
              <li key={p.name} className="flex justify-between py-2">
                <span className="truncate">{p.name}</span>
                <span className="font-semibold">{p.qty}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Peak hours (14d)</h3>
          <AnalyticsCharts kind="peaks" data={peaks} />
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Payment mix (30d)</h3>
          <AnalyticsCharts kind="paymix" data={mix} />
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Customer spend distribution</h3>
          <AnalyticsCharts kind="dist" data={dist} />
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-3">Rider leaderboard</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2">Rider</th><th>Deliveries</th><th>Rating</th><th>Earnings</th><th>Tips</th></tr>
          </thead>
          <tbody>
            {riders.map((r) => (
              <tr key={r.name} className="border-t">
                <td className="py-2">{r.name}</td>
                <td>{r.deliveries}</td>
                <td>⭐ {r.rating.toFixed(1)}</td>
                <td>{money(r.earnings)}</td>
                <td className="text-success">{money(r.tips)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="display text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}
