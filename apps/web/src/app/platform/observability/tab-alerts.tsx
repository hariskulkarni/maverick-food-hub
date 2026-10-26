'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BellOff, Bell, Check, Loader2, PlayCircle, Undo2 } from 'lucide-react';
import { useObs, Section, LoadState, Empty, StatusPill, fmtAgo, postJson, type RangeKey } from './obs-ui';

interface Alert {
  id: string; rule: string; ruleKey: string; severity: string; state: string; title: string; detail: string | null;
  firstFiredAt: string; lastSeenAt: string; resolvedAt: string | null; acknowledgedAt: string | null; notifiedAt: string | null; notifyCount: number;
}
interface AlertsResp {
  firing: Alert[];
  history: Alert[];
  mutes: Array<{ key: string; until: string; reason: string | null }>;
  rules: Array<{ rule: string; label: string; condition: string }>;
}

const MUTE_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
];

export function AlertsTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const { data, error, loading, reload } = useObs<AlertsResp>(`/api/platform/observability/alerts?range=${range}`, refreshKey);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const mute = (key: string, minutes: number) =>
    act(`mute:${key}`, () => postJson('/api/platform/observability/alerts/mutes', { key, minutes }), `Muted ${key}`);
  const unmute = (key: string) =>
    act(`unmute:${key}`, () => postJson(`/api/platform/observability/alerts/mutes?key=${encodeURIComponent(key)}`, undefined, 'DELETE'), `Unmuted ${key}`);
  const isMuted = (a: Alert) => data?.mutes.some((m) => m.key === a.ruleKey || m.key === a.rule) ?? false;

  return (
    <LoadState loading={loading} error={error} empty={!data}>
      {data ? (
        <div className="space-y-4">
          <Section
            title={`Firing now (${data.firing.length})`}
            actions={
              <Button
                variant="outline"
                size="sm"
                disabled={busy === 'eval'}
                onClick={() => act('eval', () => postJson('/api/platform/observability/alerts', { action: 'evaluate' }), 'Rules evaluated')}
              >
                {busy === 'eval' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Evaluate now
              </Button>
            }
          >
            {data.firing.length === 0 ? (
              <Empty>All clear. The evaluator runs every minute (cron: obs-alerts).</Empty>
            ) : (
              <ul className="divide-y">
                {data.firing.map((a) => (
                  <li key={a.id} className="py-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <StatusPill status={a.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium break-words">{a.title}</div>
                        {a.detail ? <div className="text-xs text-muted-foreground break-words">{a.detail}</div> : null}
                        <div className="mt-1 text-xs text-muted-foreground">
                          since {fmtAgo(a.firstFiredAt)} · notified {a.notifyCount}× {a.notifiedAt ? `(last ${fmtAgo(a.notifiedAt)})` : ''}
                          {a.acknowledgedAt ? ` · acknowledged ${fmtAgo(a.acknowledgedAt)}` : ''}
                          {isMuted(a) ? ' · muted' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-0 sm:pl-16">
                      {a.acknowledgedAt ? (
                        <Button variant="ghost" size="sm" disabled={busy === a.id} onClick={() => act(a.id, () => postJson(`/api/platform/observability/alerts/${a.id}`, { action: 'unack' }), 'Un-acknowledged')}>
                          <Undo2 className="h-4 w-4" /> Un-ack
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" disabled={busy === a.id} onClick={() => act(a.id, () => postJson(`/api/platform/observability/alerts/${a.id}`, { action: 'ack' }), 'Acknowledged — reminders stopped')}>
                          <Check className="h-4 w-4" /> Acknowledge
                        </Button>
                      )}
                      {isMuted(a) ? (
                        <Button variant="ghost" size="sm" onClick={() => unmute(data.mutes.find((m) => m.key === a.ruleKey) ? a.ruleKey : a.rule)}>
                          <Bell className="h-4 w-4" /> Unmute
                        </Button>
                      ) : (
                        <select
                          aria-label="Mute notifications"
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          defaultValue=""
                          onChange={(e) => {
                            const m = Number(e.target.value);
                            if (m) mute(a.ruleKey, m);
                            e.target.value = '';
                          }}
                        >
                          <option value="" disabled>Mute…</option>
                          {MUTE_OPTIONS.map((o) => (
                            <option key={o.minutes} value={o.minutes}>Mute {o.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Rules">
              <ul className="divide-y">
                {data.rules.map((r) => {
                  const muted = data.mutes.find((m) => m.key === r.rule);
                  return (
                    <li key={r.rule} className="py-2 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">{r.condition}</div>
                        {muted ? <div className="text-xs text-warning">muted until {new Date(muted.until).toLocaleString('en-IN')}</div> : null}
                      </div>
                      {muted ? (
                        <Button variant="ghost" size="sm" onClick={() => unmute(r.rule)}>
                          <Bell className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => mute(r.rule, 240)} aria-label={`Mute ${r.label} for 4 hours`}>
                          <BellOff className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Notifications: e-mail to every super-admin on a new alert (SMS too when CRITICAL), reminder hourly until acknowledged,
                at most one per alert per 30 min. Mutes silence notifications only.
              </p>
            </Section>
            <Section title={`History (${range})`}>
              {data.history.length === 0 ? (
                <Empty>No alerts fired in this range.</Empty>
              ) : (
                <ul className="divide-y text-sm">
                  {data.history.map((a) => (
                    <li key={a.id} className="py-2 flex items-start gap-2">
                      <StatusPill status={a.state === 'FIRING' ? a.severity : 'RESOLVED'} label={a.state === 'FIRING' ? a.severity : 'resolved'} />
                      <div className="min-w-0 flex-1">
                        <div className="break-words">{a.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(a.firstFiredAt).toLocaleString('en-IN')}
                          {a.resolvedAt ? ` → ${new Date(a.resolvedAt).toLocaleTimeString('en-IN')}` : ' → ongoing'}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      ) : null}
    </LoadState>
  );
}
