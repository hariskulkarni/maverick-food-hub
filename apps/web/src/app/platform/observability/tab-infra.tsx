'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, PlayCircle } from 'lucide-react';
import { useObs, Section, LoadState, Empty, StatusPill, Kpi, th, td, fmtAgo, fmtNum, fmtPct, postJson } from './obs-ui';

interface InfraResp {
  process: {
    pid: number; nodeVersion: string; uptimeSec: number; release: string | null; env: string; demoMode: boolean;
    memory: { rssMB: number; heapUsedMB: number; heapTotalMB: number; externalMB: number };
    eventLoop: { lastMinute: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number } | null; sinceLastRoll: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number } | null };
  };
  db: {
    connections: { total: number; max: number; byState: Record<string, number>; waiting: number } | null;
    sizeMB: number | null;
    cacheHitRatio: number | null;
    longestQueries: Array<{ pid: number; state: string; seconds: number; wait: string | null; query: string }>;
    tables: Array<{ name: string; sizeMB: number; liveRows: number; deadRows: number; deadPct: number; insertsSinceReset: number; lastVacuumAt: string | null; growthMB: number | null }>;
    growthSince: string | null;
    statements: { available: boolean; note: string | null; rows: Array<{ query: string; calls: number; meanMs: number; totalMs: number }> };
  };
  disk: { path: string; totalGB: number; freeGB: number; freePct: number } | null;
  cache: { health: { backend: string; status: string; latencyMs: number; detail?: string }; metrics: { hits: number; misses: number; hitRate: number; errors: number; uptimeSec: number } } | null;
  probes: Array<{ target: string; category: string; label: string; status: string; latencyMs: number | null; detail: string | null; consecutiveFailures: number; checkedAt: string }>;
  dependencies: Array<{ key: string; label: string; configured: boolean; detail: string; lastSuccessAt: string | null; lastFailureAt: string | null }>;
}

const up = (s: number) => (s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);

export function InfraTab({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useObs<InfraResp>('/api/platform/observability/infra', refreshKey);
  const [running, setRunning] = useState(false);
  const runChecks = async () => {
    setRunning(true);
    try {
      await postJson('/api/platform/observability/run-checks', {});
      toast.success('Probes refreshed');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const conn = data?.db.connections;
  const connPct = conn ? conn.total / conn.max : null;
  const loop = data?.process.eventLoop.lastMinute ?? data?.process.eventLoop.sinceLastRoll ?? null;
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="DB connections" value={conn ? `${conn.total}/${conn.max}` : '—'} sub={conn ? `${conn.waiting} waiting on locks` : 'unavailable'} tone={(connPct ?? 0) >= 0.9 ? 'bad' : (connPct ?? 0) >= 0.8 ? 'warn' : 'info'} />
            <Kpi label="DB size" value={data.db.sizeMB !== null ? `${fmtNum(data.db.sizeMB)} MB` : '—'} sub={`buffer hit ${fmtPct(data.db.cacheHitRatio, 1)}`} />
            <Kpi label="Disk free" value={data.disk ? `${data.disk.freePct}%` : '—'} sub={data.disk ? `${data.disk.freeGB} / ${data.disk.totalGB} GB` : 'unavailable'} tone={data.disk && data.disk.freePct <= 7 ? 'bad' : data.disk && data.disk.freePct <= 15 ? 'warn' : 'info'} />
            <Kpi label="Process memory" value={`${data.process.memory.rssMB} MB`} sub={`heap ${data.process.memory.heapUsedMB}/${data.process.memory.heapTotalMB} MB`} tone={data.process.memory.rssMB > 900 ? 'warn' : 'info'} />
            <Kpi label="Event-loop lag" value={loop ? `${loop.p99Ms} ms` : '—'} sub={loop ? `p50 ${loop.p50Ms} · max ${loop.maxMs} ms` : 'warming up'} tone={loop && loop.p99Ms > 200 ? 'warn' : 'info'} />
            <Kpi label="Uptime" value={up(data.process.uptimeSec)} sub={`${data.process.release ?? 'no release SHA'} · ${data.process.nodeVersion}`} />
          </div>

          <Section
            title="Health probes"
            actions={
              <Button variant="outline" size="sm" onClick={runChecks} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Run checks now
              </Button>
            }
          >
            {data.probes.length === 0 ? (
              <Empty>No probe results yet — run checks, or wait for the obs-alerts job.</Empty>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {data.probes.map((p) => (
                  <div key={p.target} className="rounded-lg border p-3 text-sm min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{p.label}</span>
                      <StatusPill status={p.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-words">{p.detail ?? '—'}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {p.latencyMs !== null ? `${p.latencyMs} ms · ` : ''}checked {fmtAgo(p.checkedAt)}
                      {p.consecutiveFailures ? ` · ${p.consecutiveFailures} consecutive failures` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="External dependencies">
              <ul className="divide-y">
                {data.dependencies.map((d) => (
                  <li key={d.key} className="py-2 flex items-start gap-2 text-sm">
                    <StatusPill status={d.configured ? 'UP' : 'DEGRADED'} label={d.configured ? 'configured' : 'not configured'} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{d.label}</div>
                      <div className="text-xs text-muted-foreground break-words">{d.detail}</div>
                      {d.lastSuccessAt || d.lastFailureAt ? (
                        <div className="text-xs text-muted-foreground">
                          last ok {fmtAgo(d.lastSuccessAt)} · last failure <span className={cn(d.lastFailureAt && 'text-destructive')}>{fmtAgo(d.lastFailureAt)}</span>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Cache & process">
              {data.cache ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Backend</dt>
                  <dd>{data.cache.health.backend} <StatusPill status={data.cache.health.status === 'OK' ? 'UP' : data.cache.health.status} label={data.cache.health.status} /></dd>
                  <dt className="text-muted-foreground">Redis latency</dt>
                  <dd>{data.cache.health.latencyMs} ms</dd>
                  <dt className="text-muted-foreground">Cache hit ratio</dt>
                  <dd>{fmtPct(data.cache.metrics.hitRate, 1)} ({fmtNum(data.cache.metrics.hits)} / {fmtNum(data.cache.metrics.hits + data.cache.metrics.misses)})</dd>
                  <dt className="text-muted-foreground">Cache errors</dt>
                  <dd className={cn(data.cache.metrics.errors && 'text-destructive')}>{fmtNum(data.cache.metrics.errors)}</dd>
                </dl>
              ) : (
                <Empty>Cache runtime unavailable.</Empty>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Environment</dt>
                <dd>{data.process.env}{data.process.demoMode ? ' (demo)' : ''}</dd>
                <dt className="text-muted-foreground">PID</dt>
                <dd>{data.process.pid}</dd>
                <dt className="text-muted-foreground">External memory</dt>
                <dd>{data.process.memory.externalMB} MB</dd>
              </dl>
            </Section>
          </div>

          <Section title="Longest-running queries (live)">
            {data.db.longestQueries.length === 0 ? (
              <Empty>No active queries right now.</Empty>
            ) : (
              <ul className="divide-y text-xs">
                {data.db.longestQueries.map((q) => (
                  <li key={q.pid} className="py-2">
                    <div className="flex flex-wrap gap-2 text-muted-foreground">
                      <span className={cn('font-semibold', q.seconds > 30 ? 'text-destructive' : q.seconds > 5 ? 'text-warning' : 'text-foreground')}>{q.seconds}s</span>
                      <span>{q.state}</span>
                      {q.wait ? <span>waiting: {q.wait}</span> : null}
                      <span>pid {q.pid}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{q.query}</pre>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Slow statements (pg_stat_statements)">
            {data.db.statements.available ? (
              data.db.statements.rows.length ? (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className={th}>Query</th>
                        <th className={cn(th, 'text-right')}>Calls</th>
                        <th className={cn(th, 'text-right')}>Mean</th>
                        <th className={cn(th, 'text-right')}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.db.statements.rows.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className={cn(td, 'font-mono break-all min-w-[16rem]')}>{r.query}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.calls)}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{r.meanMs} ms</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.totalMs)} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No statements recorded yet.</Empty>
              )
            ) : (
              <Empty>{data.db.statements.note}</Empty>
            )}
          </Section>

          <Section title={`Largest tables${data.db.growthSince ? ` · growth since ${new Date(data.db.growthSince).toLocaleDateString('en-IN')}` : ''}`}>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className={th}>Table</th>
                    <th className={cn(th, 'text-right')}>Size</th>
                    <th className={cn(th, 'text-right')}>Growth</th>
                    <th className={cn(th, 'text-right')}>Rows</th>
                    <th className={cn(th, 'text-right')}>Dead</th>
                    <th className={th}>Vacuumed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.db.tables.map((t) => (
                    <tr key={t.name} className="border-b last:border-0">
                      <td className={cn(td, 'font-mono text-xs')}>{t.name}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{t.sizeMB} MB</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{t.growthMB === null ? '—' : `${t.growthMB > 0 ? '+' : ''}${t.growthMB} MB`}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(t.liveRows)}</td>
                      <td className={cn(td, 'text-right tabular-nums', t.deadPct >= 20 && 'text-warning font-semibold')}>{t.deadPct}%</td>
                      <td className={cn(td, 'whitespace-nowrap text-xs')}>{fmtAgo(t.lastVacuumAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      ) : null}
    </LoadState>
  );
}
