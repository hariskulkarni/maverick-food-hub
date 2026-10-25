'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useObs, Section, LoadState, Empty, Kpi, th, td, fmtNum, fmtAgo, type RangeKey } from './obs-ui';

interface SecResp {
  logins: { failed: number; lockouts: number; breakGlass: number; unregistered: number; reasons: Array<{ reason: string; count: number }> };
  twoFactor: { failures: number; resets: number };
  passwordResets: number;
  superAdmin: { byAction: Array<{ action: string; count: number }>; recent: Array<{ id: string; action: string; entityType: string; entityId: string | null; actorId: string | null; createdAt: string }> };
  denials: Array<{ route: string; role: string; count: number }>;
  unauthenticated401: number;
  rateLimited: Array<{ route: string; count: number }>;
  webhooks: { rejects: Array<{ kind: string; source: string; detail: string; count: number }>; processingErrors: Array<{ provider: string; count: number }> };
}

export function SecurityTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const { data, error, loading } = useObs<SecResp>(`/api/platform/observability/security?range=${range}`, refreshKey);
  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Failed logins" value={fmtNum(data.logins.failed)} tone={data.logins.failed > 20 ? 'warn' : 'info'} />
            <Kpi label="Lockouts" value={fmtNum(data.logins.lockouts)} tone={data.logins.lockouts ? 'warn' : 'ok'} />
            <Kpi label="2FA failures" value={fmtNum(data.twoFactor.failures)} sub={`${data.twoFactor.resets} 2FA resets`} />
            <Kpi label="Password resets" value={fmtNum(data.passwordResets)} />
            <Kpi label="Break-glass logins" value={fmtNum(data.logins.breakGlass)} tone={data.logins.breakGlass ? 'bad' : 'ok'} />
            <Kpi label="403 denials" value={fmtNum(data.denials.reduce((a, d) => a + d.count, 0))} sub={`${fmtNum(data.unauthenticated401)} × 401`} />
            <Kpi label="Rate-limited" value={fmtNum(data.rateLimited.reduce((a, d) => a + d.count, 0))} sub="429 responses" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Failed login reasons">
              {data.logins.reasons.length === 0 ? (
                <Empty>No failed logins in this range.</Empty>
              ) : (
                <ul className="divide-y text-sm">
                  {data.logins.reasons.map((r) => (
                    <li key={r.reason} className="py-1.5 flex justify-between gap-2">
                      <span className="font-mono text-xs">{r.reason}</span>
                      <span className="tabular-nums">{fmtNum(r.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Permission denials (403) by route & role">
              {data.denials.length === 0 ? (
                <Empty>No 403 responses in this range.</Empty>
              ) : (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className={th}>Route</th>
                        <th className={th}>Role</th>
                        <th className={cn(th, 'text-right')}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.denials.map((d) => (
                        <tr key={`${d.route}|${d.role}`} className="border-b last:border-0">
                          <td className={cn(td, 'font-mono text-xs break-all')}>{d.route}</td>
                          <td className={cn(td, 'text-xs')}>{d.role}</td>
                          <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(d.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Rate-limit hits (429) by route">
              {data.rateLimited.length === 0 ? (
                <Empty>No rate-limited requests in this range.</Empty>
              ) : (
                <ul className="divide-y text-sm">
                  {data.rateLimited.map((r) => (
                    <li key={r.route} className="py-1.5 flex justify-between gap-2">
                      <span className="font-mono text-xs break-all">{r.route}</span>
                      <span className="tabular-nums">{fmtNum(r.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Webhook signature / auth failures">
              {data.webhooks.rejects.length === 0 && data.webhooks.processingErrors.length === 0 ? (
                <Empty>No rejected or failed webhooks in this range.</Empty>
              ) : (
                <ul className="divide-y text-sm">
                  {data.webhooks.rejects.map((w, i) => (
                    <li key={`r${i}`} className="py-1.5 flex justify-between gap-2">
                      <span className="break-all">
                        <span className="font-mono text-xs">{w.source}</span>{' '}
                        <span className="text-xs text-muted-foreground">{w.kind === 'webhook_sig' ? `signature: ${w.detail}` : `HTTP ${w.detail}`}</span>
                      </span>
                      <span className="tabular-nums">{fmtNum(w.count)}</span>
                    </li>
                  ))}
                  {data.webhooks.processingErrors.map((w) => (
                    <li key={`p${w.provider}`} className="py-1.5 flex justify-between gap-2">
                      <span className="text-xs">{w.provider} — processing errors</span>
                      <span className="tabular-nums">{fmtNum(w.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="Super-admin actions" actions={<Link href="/platform/audit-log" className="text-sm text-primary hover:underline">Full audit log</Link>}>
            {data.superAdmin.recent.length === 0 ? (
              <Empty>No super-admin actions in this range.</Empty>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                <ul className="divide-y text-sm">
                  {data.superAdmin.byAction.map((a) => (
                    <li key={a.action} className="py-1.5 flex justify-between gap-2">
                      <span className="font-mono text-xs break-all">{a.action}</span>
                      <span className="tabular-nums">{a.count}</span>
                    </li>
                  ))}
                </ul>
                <ul className="divide-y text-xs lg:col-span-2">
                  {data.superAdmin.recent.map((r) => (
                    <li key={r.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                      <span className="font-mono break-all">{r.action}</span>
                      <span className="text-muted-foreground">
                        {r.entityType}
                        {r.entityId ? ` ${r.entityId.slice(0, 10)}…` : ''} · {fmtAgo(r.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </LoadState>
  );
}
