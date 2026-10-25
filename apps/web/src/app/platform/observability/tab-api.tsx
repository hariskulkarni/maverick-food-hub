'use client';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, Search } from 'lucide-react';
import { useObs, Section, LoadState, Empty, TrafficChart, LatencyChart, Kpi, th, td, fmtPct, fmtMs, fmtNum, type RangeKey } from './obs-ui';

interface RouteStat {
  route: string; method: string; kind: string; count: number; rpm: number; s4xx: number; s5xx: number;
  s401: number; s403: number; s429: number; errorRate: number; clientErrorRate: number;
  avgMs: number | null; p50: number | null; p95: number | null; p99: number | null; maxMs: number;
}
interface Point { t: string; count: number; s4xx: number; s5xx: number; p50: number | null; p95: number | null; p99: number | null }
interface ApiResp { routes: RouteStat[] | null; series: Point[] }

type SortKey = 'count' | 'errorRate' | 'p95' | 'p99' | 'clientErrorRate';

export function ApiTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const [kind, setKind] = useState<'API' | 'PAGE'>('API');
  const [sel, setSel] = useState<{ route: string; method: string } | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('count');
  const list = useObs<ApiResp>(`/api/platform/observability/api?range=${range}&kind=${kind}`, refreshKey);
  const drill = useObs<ApiResp>(
    sel ? `/api/platform/observability/api?range=${range}&route=${encodeURIComponent(sel.route)}&method=${sel.method}` : null,
    refreshKey,
  );

  const rows = useMemo(() => {
    const all = list.data?.routes ?? [];
    const f = q ? all.filter((r) => r.route.toLowerCase().includes(q.toLowerCase())) : all;
    return [...f].sort((a, b) => (Number(b[sort] ?? -1) || 0) - (Number(a[sort] ?? -1) || 0));
  }, [list.data, q, sort]);

  if (sel) {
    const stat = list.data?.routes?.find((r) => r.route === sel.route && r.method === sel.method);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
          <ArrowLeft className="h-4 w-4" /> All routes
        </Button>
        <h2 className="font-mono text-sm sm:text-base break-all">
          <span className="font-semibold">{sel.method}</span> {sel.route}
        </h2>
        {stat ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Requests" value={fmtNum(stat.count)} sub={`${stat.rpm}/min`} />
            <Kpi label="5xx" value={fmtPct(stat.errorRate, 2)} tone={stat.errorRate >= 0.05 ? 'bad' : stat.errorRate > 0 ? 'warn' : 'ok'} sub={`${stat.s5xx} errors`} />
            <Kpi label="4xx" value={fmtPct(stat.clientErrorRate, 1)} sub={`401 ${stat.s401} · 403 ${stat.s403} · 429 ${stat.s429}`} />
            <Kpi label="P50" value={fmtMs(stat.p50)} />
            <Kpi label="P95" value={fmtMs(stat.p95)} />
            <Kpi label="P99" value={fmtMs(stat.p99)} />
            <Kpi label="Max" value={fmtMs(stat.maxMs)} />
          </div>
        ) : null}
        <LoadState loading={drill.loading} error={drill.error} empty={!drill.data}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Traffic & errors">
              <TrafficChart data={drill.data?.series ?? []} range={range} />
            </Section>
            <Section title="Latency">
              <LatencyChart data={drill.data?.series ?? []} range={range} />
            </Section>
          </div>
        </LoadState>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`${kind === 'API' ? 'API' : 'Page'} traffic & errors`}>
          <TrafficChart data={list.data?.series ?? []} range={range} />
        </Section>
        <Section title="Latency (all routes)">
          <LatencyChart data={list.data?.series ?? []} range={range} />
        </Section>
      </div>
      <Section
        title="Golden signals per route"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md bg-muted p-0.5">
              {(['API', 'PAGE'] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={cn('h-8 rounded px-3 text-xs font-medium', kind === k ? 'bg-background shadow' : 'text-muted-foreground')}>
                  {k === 'API' ? 'API routes' : 'Pages'}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter routes" className="pl-8 h-9" />
            </div>
          </div>
        }
      >
        <LoadState loading={list.loading} error={list.error} empty={!list.data}>
          {rows.length === 0 ? (
            <Empty>No requests recorded for this range. Metrics are aggregated per minute and flushed every 30 s.</Empty>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className={th}>Route</th>
                    {(
                      [
                        ['count', 'Req'],
                        ['errorRate', '5xx'],
                        ['clientErrorRate', '4xx'],
                        ['p95', 'P95'],
                        ['p99', 'P99'],
                      ] as Array<[SortKey, string]>
                    ).map(([k, l]) => (
                      <th key={k} className={cn(th, 'text-right')}>
                        <button onClick={() => setSort(k)} className={cn('uppercase', sort === k && 'text-foreground')}>
                          {l}
                          {sort === k ? ' ↓' : ''}
                        </button>
                      </th>
                    ))}
                    <th className={cn(th, 'text-right')}>P50</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr
                      key={`${r.method} ${r.route}`}
                      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setSel({ route: r.route, method: r.method })}
                    >
                      <td className={cn(td, 'font-mono text-xs break-all min-w-[12rem]')}>
                        <span className="font-semibold">{r.method}</span> {r.route}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.count)}</td>
                      <td className={cn(td, 'text-right tabular-nums', r.errorRate >= 0.05 ? 'text-destructive font-semibold' : r.errorRate > 0 && 'text-warning')}>
                        {fmtPct(r.errorRate, 1)}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtPct(r.clientErrorRate, 1)}</td>
                      <td className={cn(td, 'text-right tabular-nums', (r.p95 ?? 0) >= 1500 && 'text-warning font-semibold')}>{fmtMs(r.p95)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(r.p99)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(r.p50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Percentiles are interpolated from fixed latency buckets (±25% within a bucket). Tap a route for its trend.
          </p>
        </LoadState>
      </Section>
    </div>
  );
}
