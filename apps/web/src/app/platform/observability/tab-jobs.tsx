'use client';
import { Fragment, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useObs, Section, LoadState, Empty, StatusPill, Kpi, th, td, fmtAgo, fmtMs, fmtPct, fmtMin, fmtNum, type RangeKey } from './obs-ui';

interface Run { id: string; status: string; trigger: string; startedAt: string; durationMs: number | null; httpStatus: number | null; summary: string | null; error: string | null }
interface Job {
  job: string; cron: string | null; periodMin: number | null; description: string; health: string;
  lastRunAt: string | null; lastStatus: string | null; minutesSinceLastRun: number | null; successRate: number | null;
  consecutiveFailures: number; avgDurationMs: number | null; rangeRuns: number; rangeSuccessRate: number | null; runs: Run[];
}
interface JobsResp { jobs: Job[]; queue: { byStatus: Record<string, number>; staleLocked: number } }

export function JobsTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const { data, error, loading } = useObs<JobsResp>(`/api/platform/observability/jobs?range=${range}`, refreshKey);
  const [open, setOpen] = useState<string | null>(null);
  const bad = data?.jobs.filter((j) => j.health === 'OVERDUE' || j.health === 'FAILING').length ?? 0;
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Scheduled jobs" value={fmtNum(data.jobs.filter((j) => j.cron).length)} />
            <Kpi label="Overdue / failing" value={fmtNum(bad)} tone={bad ? 'bad' : 'ok'} />
            <Kpi label="Queue pending" value={fmtNum(data.queue.byStatus.PENDING ?? 0)} sub={`failed ${data.queue.byStatus.FAILED ?? 0}`} />
            <Kpi label="Stale locks" value={fmtNum(data.queue.staleLocked)} tone={data.queue.staleLocked ? 'warn' : 'ok'} sub="PROCESSING > 15 min" />
          </div>
          <Section title="Scheduled jobs">
            {data.jobs.length === 0 ? (
              <Empty>No jobs found.</Empty>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className={th}>Job</th>
                      <th className={th}>Health</th>
                      <th className={th}>Schedule</th>
                      <th className={th}>Last run</th>
                      <th className={cn(th, 'text-right')}>Success ({range})</th>
                      <th className={cn(th, 'text-right')}>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <Fragment key={j.job}>
                        <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(open === j.job ? null : j.job)}>
                          <td className={cn(td, 'min-w-[11rem]')}>
                            <div className="flex items-center gap-1 font-medium">
                              <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', open === j.job && 'rotate-90')} />
                              <span className="font-mono text-xs">{j.job}</span>
                            </div>
                            {j.description ? <div className="text-xs text-muted-foreground line-clamp-1 pl-5">{j.description}</div> : null}
                          </td>
                          <td className={td}>
                            <StatusPill status={j.health} />
                            {j.consecutiveFailures > 1 ? <div className="text-xs text-destructive mt-0.5">{j.consecutiveFailures} fails in a row</div> : null}
                          </td>
                          <td className={cn(td, 'whitespace-nowrap')}>
                            <span className="font-mono text-xs">{j.cron ?? '—'}</span>
                            {j.periodMin ? <div className="text-xs text-muted-foreground">every {fmtMin(j.periodMin)}</div> : null}
                          </td>
                          <td className={cn(td, 'whitespace-nowrap')}>
                            {fmtAgo(j.lastRunAt)}
                            {j.lastStatus ? <div className="text-xs text-muted-foreground">{j.lastStatus.toLowerCase()}</div> : null}
                          </td>
                          <td className={cn(td, 'text-right tabular-nums')}>
                            {fmtPct(j.rangeSuccessRate, 0)}
                            <div className="text-xs text-muted-foreground">{j.rangeRuns} runs</div>
                          </td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(j.avgDurationMs)}</td>
                        </tr>
                        {open === j.job ? (
                          <tr className="border-b bg-muted/20">
                            <td colSpan={6} className="p-2">
                              {j.runs.length === 0 ? (
                                <div className="text-xs text-muted-foreground p-2">No runs recorded yet. Runs are captured automatically when cron calls /api/platform/jobs/{j.job}/run.</div>
                              ) : (
                                <ul className="divide-y text-xs">
                                  {j.runs.map((r) => (
                                    <li key={r.id} className="py-1.5 flex flex-wrap items-start gap-2">
                                      <StatusPill status={r.status} />
                                      <span className="whitespace-nowrap">{new Date(r.startedAt).toLocaleString('en-IN')}</span>
                                      <span className="text-muted-foreground">{fmtMs(r.durationMs)} · {r.trigger.toLowerCase()}{r.httpStatus ? ` · HTTP ${r.httpStatus}` : ''}</span>
                                      {r.error ? <span className="basis-full text-destructive break-words">{r.error}</span> : null}
                                      {r.summary ? <span className="basis-full font-mono text-muted-foreground break-all">{r.summary}</span> : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Expected cadence comes from deploy/flavrly-jobs.cron. A job is overdue after its period + max(3 min, 25%).
            </p>
          </Section>
        </div>
      ) : null}
    </LoadState>
  );
}
