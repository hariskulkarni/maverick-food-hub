/**
 * Platform · Review analytics (SUPER_ADMIN). Read-only.
 */
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { requireSuperAdmin } from '@/server/tenancy';
import { loadReviewsAnalytics } from '@/server/reviews-analytics';

export const metadata = { title: 'Platform · Review analytics' };
export const dynamic = 'force-dynamic';

const f1 = (n: number | null) => (n == null ? '–' : n.toFixed(2));

export default async function ReviewsAnalyticsPage() {
  await requireSuperAdmin();
  const d = await loadReviewsAnalytics(30);
  const maxDist = Math.max(1, ...Object.values(d.distribution));
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.count));
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Review analytics</h1>
        <p className="text-sm text-muted-foreground">All restaurants · last 30 days · in-app feedback and Google reviews.</p>
      </header>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Kpi title="Food" value={f1(d.averages.food)} />
        <Kpi title="Delivery" value={f1(d.averages.delivery)} />
        <Kpi title="Overall" value={f1(d.averages.overall)} sub={`${d.counts.feedback} in-app reviews`} />
        <Kpi title="Google" value={f1(d.google.average)} sub={`${d.google.count} reviews`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Overall rating distribution</h3>
          <ul className="space-y-2 text-sm">
            {([5, 4, 3, 2, 1] as const).map((s) => (
              <li key={s} className="flex items-center gap-3">
                <span className="w-8 shrink-0">{s}★</span>
                <div className="h-3 flex-1 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${(d.distribution[s] / maxDist) * 100}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums">{d.distribution[s]}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="font-semibold mb-3">Volume by day</h3>
          {d.trend.length === 0 ? <p className="text-sm text-muted-foreground">No reviews in range.</p> : (
            <ul className="space-y-1.5 text-sm">
              {d.trend.map((t) => (
                <li key={t.day} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-muted-foreground">{t.day.slice(5)}</span>
                  <div className="h-2.5 flex-1 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(t.count / maxTrend) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right tabular-nums">{t.count} · {f1(t.avgOverall)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-3">Low-star reviews (≤2★)</h3>
        {d.lowStar.length === 0 ? <p className="text-sm text-muted-foreground">None. 🎉</p> : (
          <ul className="divide-y text-sm">
            {d.lowStar.map((l) => (
              <li key={`${l.source}-${l.id}`} className="py-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.rating}★ <span className="text-xs text-muted-foreground uppercase">{l.source}</span>
                  </div>
                  {l.comment && <p className="text-muted-foreground break-words">{l.comment}</p>}
                </div>
                <div className="text-xs text-muted-foreground sm:text-right shrink-0 space-y-0.5">
                  <div>{l.at.slice(0, 10)}</div>
                  {l.restaurantId && <div><Link className="underline" href={`/platform/restaurants/${l.restaurantId}`}>{l.restaurantName ?? 'Restaurant'}</Link></div>}
                  {l.orderId && <div><Link className="underline" href={`/platform/orders?q=${encodeURIComponent(l.orderCode ?? l.orderId)}`}>Order {l.orderCode ?? l.orderId}</Link></div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}
