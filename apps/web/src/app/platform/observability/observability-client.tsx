'use client';
/**
 * Observability Center (super-admin + 2FA only — enforced server-side on the
 * page and on every /api/platform/observability/** route).
 *
 * Tabs: Overview · API · Errors · Jobs · Notifications · Business · Infra ·
 * Security · Alerts. Shared time range (15m/1h/24h/7d), auto-refresh (30s),
 * deep-linkable via ?tab=&range=.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RefreshCw, ExternalLink, Pause, Play } from 'lucide-react';
import type { RangeKey } from './obs-ui';
import { OverviewTab } from './tab-overview';
import { ApiTab } from './tab-api';
import { ErrorsTab } from './tab-errors';
import { JobsTab } from './tab-jobs';
import { NotificationsTab } from './tab-notifications';
import { BusinessTab } from './tab-business';
import { InfraTab } from './tab-infra';
import { SecurityTab } from './tab-security';
import { AlertsTab } from './tab-alerts';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'api', label: 'API' },
  { key: 'errors', label: 'Errors' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'business', label: 'Business' },
  { key: 'infra', label: 'Infra' },
  { key: 'security', label: 'Security' },
  { key: 'alerts', label: 'Alerts' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const RANGES: RangeKey[] = ['15m', '1h', '24h', '7d'];
const REFRESH_MS = 30_000;

export function ObservabilityClient() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [range, setRange] = useState<RangeKey>('1h');
  const [auto, setAuto] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Restore from the URL once (deep links from alert e-mails use ?tab=alerts).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    const r = sp.get('range');
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey);
    if (r && (RANGES as string[]).includes(r)) setRange(r as RangeKey);
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.set('tab', tab);
    sp.set('range', range);
    window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`);
  }, [tab, range]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    setUpdatedAt(new Date());
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, refresh]);

  const go = useCallback((t: string) => {
    if (TABS.some((x) => x.key === t)) setTab(t as TabKey);
  }, []);

  return (
    <div className="space-y-4 min-w-0">
      {/* Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'h-9 min-w-[44px] rounded-md px-3 text-sm font-medium',
                  range === r ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={range === r}
              >
                {r}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} aria-label="Refresh now">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
            {auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {auto ? 'Auto 30s' : 'Paused'}
          </Button>
          {updatedAt ? <span className="text-xs text-muted-foreground">Updated {updatedAt.toLocaleTimeString('en-IN')}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/platform/dispatch-insights" className="inline-flex items-center gap-1 text-primary hover:underline">
            Dispatch insights <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Link href="/platform/audit-log" className="inline-flex items-center gap-1 text-primary hover:underline">
            Audit log <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Link href="/platform/system-health" className="inline-flex items-center gap-1 text-primary hover:underline">
            System health <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Tabs — horizontally scrollable on phones */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex h-10 items-center rounded-lg bg-muted p-1 text-muted-foreground" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
                tab === t.key ? 'bg-background text-foreground shadow' : 'hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="min-w-0">
        {tab === 'overview' && <OverviewTab range={range} refreshKey={refreshKey} go={go} />}
        {tab === 'api' && <ApiTab range={range} refreshKey={refreshKey} />}
        {tab === 'errors' && <ErrorsTab range={range} refreshKey={refreshKey} />}
        {tab === 'jobs' && <JobsTab range={range} refreshKey={refreshKey} />}
        {tab === 'notifications' && <NotificationsTab range={range} refreshKey={refreshKey} />}
        {tab === 'business' && <BusinessTab range={range} refreshKey={refreshKey} />}
        {tab === 'infra' && <InfraTab refreshKey={refreshKey} />}
        {tab === 'security' && <SecurityTab range={range} refreshKey={refreshKey} />}
        {tab === 'alerts' && <AlertsTab range={range} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}
