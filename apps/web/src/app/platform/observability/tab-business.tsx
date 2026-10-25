'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useObs, Section, LoadState, Empty, StatusPill, Kpi, CountChart, th, td, fmtPct, fmtNum, fmtMin, fmtAgo, type RangeKey } from './obs-ui';

interface Stuck { key: string; label: string; thresholdMin: number; count: number; oldestMin: number | null; sample: Array<{ id: string; code: string; status: string; ageMin: number }> }
interface BizResp {
  orders: { total: number; perMin: number; byStatus: Record<string, number>; series: Array<{ t: string; count: number }> };
  payments: Array<{ provider: string; method: string; success: number; failed: number; pending: number; refunded: number; successRate: number | null }>;
  stuck: Stuck[];
  refunds: { pending: number; oldestPendingMin: number | null };
  reviews: { lastSyncAt: string | null; minutesSinceSync: number | null; totalReviews: number; replyFailures24h: number };
  support: { open: Record<string, number>; urgentOpen: number; oldestOpenMin: number | null; riderTicketsOpen: number };
  riders: { online: number; offline: number; total: number; heartbeat: { fresh: number; stale: number; dead: number; none: number }; location: { fresh: number; stale: number } };
  sos: { open: number; oldestMin: number | null; alerts: Array<{ id: string; riderId: string; ageMin: number }> };
  providers: Array<{ key: string; label: string; status: string; detail?: string; meta?: Record<string, unknown> }>;
}

export function BusinessTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const { data, error, loading } = useObs<BizResp>(`/api/platform/observability/business?range=${range}`, refreshKey);
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Orders" value={fmtNum(data.orders.total)} sub={`${data.orders.perMin}/min`} />
            <Kpi label="Stuck orders" value={fmtNum(data.stuck.reduce((a, s) => a + s.count, 0))} tone={data.stuck.some((s) => s.count) ? 'warn' : 'ok'} />
            <Kpi label="Refunds pending" value={fmtNum(data.refunds.pending)} sub={data.refunds.oldestPendingMin !== null ? `oldest ${fmtMin(data.refunds.oldestPendingMin)}` : undefined} tone={data.refunds.pending ? 'warn' : 'ok'} />
            <Kpi label="Riders online" value={`${data.riders.online}/${data.riders.total}`} sub={`${data.riders.heartbeat.stale + data.riders.heartbeat.dead} stale heartbeat`} />
            <Kpi label="Open SOS" value={fmtNum(data.sos.open)} tone={data.sos.open ? 'bad' : 'ok'} sub={data.sos.oldestMin !== null ? `oldest ${fmtMin(data.sos.oldestMin)}` : undefined} />
            <Kpi label="Support open" value={fmtNum(Object.values(data.support.open).reduce((a, b) => a + b, 0))} sub={`${data.support.urgentOpen} urgent · ${data.support.riderTicketsOpen} rider`} tone={data.support.urgentOpen ? 'warn' : 'info'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Orders placed">
              <CountChart data={data.orders.series} range={range} label="Orders" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(data.orders.byStatus).map(([s, n]) => (
                  <span key={s} className="rounded bg-muted px-2 py-0.5 text-xs">{s.toLowerCase().replace(/_/g, ' ')}: {n}</span>
                ))}
              </div>
            </Section>
            <Section title="Stuck orders (by status age)">
              <ul className="space-y-3">
                {data.stuck.map((s) => (
                  <li key={s.key}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {s.label} <span className="text-xs text-muted-foreground">(&gt; {s.thresholdMin} min)</span>
                      </span>
                      <StatusPill status={s.count ? (s.count >= 3 ? 'CRITICAL' : 'WARNING') : 'OK'} label={String(s.count)} />
                    </div>
                    {s.sample.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.sample.map((o) => (
                          <Link key={o.id} href={`/platform/orders?q=${encodeURIComponent(o.code)}`} className="rounded border px-1.5 py-0.5 text-xs font-mono hover:bg-muted">
                            {o.code} · {fmtMin(o.ageMin)}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Payments by provider">
              {data.payments.length === 0 ? (
                <Empty>No payments in this range.</Empty>
              ) : (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className={th}>Provider</th>
                        <th className={cn(th, 'text-right')}>Success</th>
                        <th className={cn(th, 'text-right')}>Failed</th>
                        <th className={cn(th, 'text-right')}>Pending</th>
                        <th className={cn(th, 'text-right')}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.provider} className="border-b last:border-0">
                          <td className={cn(td, 'capitalize')}>{p.provider}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(p.success)}</td>
                          <td className={cn(td, 'text-right tabular-nums', p.failed && 'text-destructive')}>{fmtNum(p.failed)}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(p.pending)}</td>
                          <td className={cn(td, 'text-right tabular-nums', (p.successRate ?? 1) < 0.85 && 'text-warning font-semibold')}>{fmtPct(p.successRate, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.providers.map((p) => (
                  <div key={p.key} className="rounded-lg border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{p.label}</span>
                      <StatusPill status={p.status} />
                    </div>
                    {p.detail ? <div className="mt-1 text-muted-foreground">{p.detail}</div> : null}
                    {p.meta && typeof p.meta.lastWebhookAt !== 'undefined' ? (
                      <div className="mt-0.5 text-muted-foreground">
                        Last webhook {fmtAgo(p.meta.lastWebhookAt as string | null)} · webhook errors 24h: {String(p.meta.webhookErrors24h ?? 0)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Riders, reviews & support">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <dt className="text-xs uppercase text-muted-foreground">Rider heartbeat (online riders)</dt>
                  <dd className="mt-1 space-y-0.5">
                    <div>Fresh (&lt; 2 min): <strong>{data.riders.heartbeat.fresh}</strong></div>
                    <div>Stale (2–10 min): <strong className={cn(data.riders.heartbeat.stale && 'text-warning')}>{data.riders.heartbeat.stale}</strong></div>
                    <div>Dead (&gt; 10 min): <strong className={cn(data.riders.heartbeat.dead && 'text-destructive')}>{data.riders.heartbeat.dead}</strong></div>
                    <div>Never pinged: {data.riders.heartbeat.none}</div>
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs uppercase text-muted-foreground">Location ping freshness</dt>
                  <dd className="mt-1 space-y-0.5">
                    <div>Fresh (&lt; 2 min): <strong>{data.riders.location.fresh}</strong></div>
                    <div>Stale / none: <strong className={cn(data.riders.location.stale && 'text-warning')}>{data.riders.location.stale}</strong></div>
                    <div className="text-xs text-muted-foreground">Offline riders: {data.riders.offline}</div>
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs uppercase text-muted-foreground">Google review sync</dt>
                  <dd className="mt-1 space-y-0.5">
                    <div>Last synced: <strong>{fmtAgo(data.reviews.lastSyncAt)}</strong></div>
                    <div>Reviews stored: {fmtNum(data.reviews.totalReviews)}</div>
                    <div>Reply failures (24h): <strong className={cn(data.reviews.replyFailures24h && 'text-destructive')}>{data.reviews.replyFailures24h}</strong></div>
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs uppercase text-muted-foreground">Support tickets</dt>
                  <dd className="mt-1 space-y-0.5">
                    <div>Open: {data.support.open.OPEN ?? 0} · In progress: {data.support.open.IN_PROGRESS ?? 0}</div>
                    <div>Urgent: <strong className={cn(data.support.urgentOpen && 'text-destructive')}>{data.support.urgentOpen}</strong></div>
                    <div>Oldest open: {fmtMin(data.support.oldestOpenMin)}</div>
                  </dd>
                </div>
              </dl>
              {data.sos.alerts.length ? (
                <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <strong className="text-destructive">Open SOS:</strong>{' '}
                  {data.sos.alerts.map((s) => `${fmtMin(s.ageMin)} ago`).join(', ')} —{' '}
                  <Link href="/platform/rider-sos" className="text-primary hover:underline">respond</Link>
                </div>
              ) : null}
            </Section>
          </div>
          <p className="text-xs text-muted-foreground">
            Dispatch KPIs (assignment latency, wait at restaurant, on-time %) live on{' '}
            <Link href="/platform/dispatch-insights" className="text-primary hover:underline">Dispatch insights</Link>.
          </p>
        </div>
      ) : null}
    </LoadState>
  );
}
