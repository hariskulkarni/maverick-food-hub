'use client';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useObs, Kpi, Section, LoadState, Empty, StatusPill, TrafficChart, LatencyChart, fmtPct, fmtMs, fmtNum, fmtAgo, type RangeKey } from './obs-ui';

interface Overview {
  score: number;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  kpis: {
    requests: number; rpm: number; errorRate: number; p50: number | null; p95: number | null; p99: number | null;
    unresolvedErrors: number; newErrorGroups1h: number; probesDown: number; stuckOrders: number;
  };
  series: Array<{ t: string; count: number; s4xx: number; s5xx: number; p50: number | null; p95: number | null; p99: number | null }>;
  alerts: Array<{ id: string; severity: string; title: string; detail: string | null; firstFiredAt: string; acknowledgedAt: string | null }>;
}

export function OverviewTab({ range, refreshKey, go }: { range: RangeKey; refreshKey: number; go: (t: string) => void }) {
  const { data, error, loading } = useObs<Overview>(`/api/platform/observability/overview?range=${range}`, refreshKey);
  const tone = data?.status === 'HEALTHY' ? 'ok' : data?.status === 'DEGRADED' ? 'warn' : 'bad';
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className={cn('min-w-0', tone === 'bad' && 'border-destructive/50', tone === 'warn' && 'border-warning/50')}>
              <CardContent className="p-5 flex items-center gap-5">
                <div
                  className={cn(
                    'flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-8 text-3xl font-bold tabular-nums',
                    tone === 'ok' && 'border-success/60 text-success',
                    tone === 'warn' && 'border-warning/60 text-warning',
                    tone === 'bad' && 'border-destructive/60 text-destructive',
                  )}
                  aria-label={`Health score ${data.score} of 100`}
                >
                  {data.score}
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Platform health</div>
                  <div className="mt-1"><StatusPill status={data.status} /></div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Score from 5xx rate &amp; P95 (last 15 min), firing alerts, down probes and new error groups.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Section
              title={`Active alerts (${data.alerts.length})`}
              className="lg:col-span-2"
              actions={<button className="text-sm text-primary hover:underline" onClick={() => go('alerts')}>Manage alerts</button>}
            >
              {data.alerts.length === 0 ? (
                <Empty>No alerts firing. Rules are evaluated every minute by the obs-alerts job.</Empty>
              ) : (
                <ul className="divide-y">
                  {data.alerts.slice(0, 6).map((a) => (
                    <li key={a.id} className="py-2 flex items-start gap-3">
                      <StatusPill status={a.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium break-words">{a.title}</div>
                        {a.detail ? <div className="text-xs text-muted-foreground break-words">{a.detail}</div> : null}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtAgo(a.firstFiredAt)}
                        {a.acknowledgedAt ? ' · ack' : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Requests" value={fmtNum(data.kpis.requests)} sub={`${data.kpis.rpm}/min`} onClick={() => go('api')} />
            <Kpi label="5xx rate" value={fmtPct(data.kpis.errorRate, 2)} tone={data.kpis.errorRate >= 0.05 ? 'bad' : data.kpis.errorRate >= 0.02 ? 'warn' : 'ok'} onClick={() => go('api')} />
            <Kpi label="P50" value={fmtMs(data.kpis.p50)} onClick={() => go('api')} />
            <Kpi label="P95" value={fmtMs(data.kpis.p95)} tone={(data.kpis.p95 ?? 0) >= 1500 ? 'warn' : 'info'} onClick={() => go('api')} />
            <Kpi label="P99" value={fmtMs(data.kpis.p99)} onClick={() => go('api')} />
            <Kpi label="Open errors" value={fmtNum(data.kpis.unresolvedErrors)} sub={`${data.kpis.newErrorGroups1h} new in 1h`} tone={data.kpis.newErrorGroups1h ? 'warn' : 'info'} onClick={() => go('errors')} />
            <Kpi label="Probes down" value={fmtNum(data.kpis.probesDown)} tone={data.kpis.probesDown ? 'bad' : 'ok'} onClick={() => go('infra')} />
            <Kpi label="Stuck orders" value={fmtNum(data.kpis.stuckOrders)} tone={data.kpis.stuckOrders ? 'warn' : 'ok'} onClick={() => go('business')} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="API traffic & errors">
              <TrafficChart data={data.series} range={range} />
            </Section>
            <Section title="API latency">
              <LatencyChart data={data.series} range={range} />
            </Section>
          </div>
        </div>
      ) : null}
    </LoadState>
  );
}
