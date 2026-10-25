'use client';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { useObs, Section, LoadState, Empty, StatusPill, Kpi, th, td, fmtPct, fmtNum, fmtAgo, type RangeKey } from './obs-ui';

interface NotifResp {
  production: boolean;
  channels: Array<{ channel: string; provider: string; sent: number; failed: number; queued: number; failureRate: number | null; mockSends: number; liveSends: number }>;
  templates: Array<{ template: string; sent: number; failed: number; queued: number }>;
  failureReasons: Array<{ channel: string; reason: string; count: number; lastAt: string }>;
  mock: { channelsUsingMock: string[]; problem: boolean };
}

export function NotificationsTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const { data, error, loading } = useObs<NotifResp>(`/api/platform/observability/notifications?range=${range}`, refreshKey);
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          {data.mock.channelsUsingMock.length ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-sm',
                data.mock.problem ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-warning/40 bg-warning/5',
              )}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Mock notifier in use: {data.mock.channelsUsingMock.join(', ')}.</strong>{' '}
                {data.mock.problem
                  ? 'This is the production instance — these messages are journaled but NOT delivered to customers/riders.'
                  : 'Expected on demo / development instances.'}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.channels.map((c) => (
              <Kpi
                key={c.channel}
                label={`${c.channel} · ${c.provider}`}
                value={fmtNum(c.sent + c.failed)}
                sub={`${fmtPct(c.failureRate, 1)} failed${c.mockSends ? ` · ${c.mockSends} mock` : ''}`}
                tone={(c.failureRate ?? 0) >= 0.2 ? 'bad' : (c.failureRate ?? 0) > 0 ? 'warn' : c.provider === 'mock' && data.production ? 'warn' : 'info'}
              />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Delivery by template">
              {data.templates.length === 0 ? (
                <Empty>No notifications in this range.</Empty>
              ) : (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className={th}>Template</th>
                        <th className={cn(th, 'text-right')}>Sent</th>
                        <th className={cn(th, 'text-right')}>Failed</th>
                        <th className={cn(th, 'text-right')}>Fail %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.templates.map((t) => {
                        const rate = t.sent + t.failed ? t.failed / (t.sent + t.failed) : null;
                        return (
                          <tr key={t.template} className="border-b last:border-0">
                            <td className={cn(td, 'font-mono text-xs break-all')}>{t.template}</td>
                            <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(t.sent)}</td>
                            <td className={cn(td, 'text-right tabular-nums', t.failed && 'text-destructive')}>{fmtNum(t.failed)}</td>
                            <td className={cn(td, 'text-right tabular-nums')}>{fmtPct(rate, 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
            <Section title="Top failure reasons">
              {data.failureReasons.length === 0 ? (
                <Empty>No failed deliveries in this range.</Empty>
              ) : (
                <ul className="divide-y">
                  {data.failureReasons.map((r, i) => (
                    <li key={i} className="py-2 flex items-start gap-2 text-sm">
                      <StatusPill status="FAILED" label={r.channel} />
                      <div className="min-w-0 flex-1 break-words">{r.reason}</div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap text-right">
                        ×{r.count}
                        <br />
                        {fmtAgo(r.lastAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <p className="text-xs text-muted-foreground">
            Source: NotificationLog (every notify.sms / whatsapp / email is journaled) plus live/mock counters from the dispatcher.
            Provider shown is the environment default; restaurants with their own integration credentials may use a different provider.
          </p>
        </div>
      ) : null}
    </LoadState>
  );
}
