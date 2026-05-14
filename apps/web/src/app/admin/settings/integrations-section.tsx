'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { IntegrationWizard, type FieldDef } from './integration-wizard';
import { CheckCircle2, AlertTriangle, CircleSlash, Settings, RefreshCw, Info, ShieldCheck } from 'lucide-react';

type Status = 'CONNECTED' | 'DISCONNECTED' | 'FAILED';

interface IntegrationRow {
  provider: string;
  title: string;
  vendor: string;
  description: string;
  docsUrl: string;
  fields: FieldDef[];
  status: Status;
  summary: Record<string, any> | null;
  lastTestedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export function IntegrationsSection() {
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<IntegrationRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/admin/integrations', { cache: 'no-store' });
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">
              Connect each integration with its credentials. We test before saving and store keys encrypted at rest.
            </p>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <IntegrationCard key={row.provider} row={row} onConfigure={() => setActive(row)} />
            ))}
            {loading && rows.length === 0 && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-muted/20 h-24 shimmer" />
            ))}
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 mt-0.5 shrink-0 text-success" />
            <div>
              Each integration is verified live against the provider before save. Credentials are encrypted with AES-256-GCM
              and only the last 4 characters of any secret are ever shown back to you. When disconnected, the system silently
              falls back to mock mode — orders still flow through, but messages and payments stay in-app.
            </div>
          </div>
        </CardContent>
      </Card>

      {active && (
        <IntegrationWizard
          open={!!active}
          onClose={() => setActive(null)}
          provider={active.provider}
          title={active.title}
          vendor={active.vendor}
          description={active.description}
          docsUrl={active.docsUrl}
          fields={active.fields}
          initialSummary={active.summary}
          isConnected={active.status === 'CONNECTED'}
          onSaved={load}
        />
      )}
    </>
  );
}

function IntegrationCard({ row, onConfigure }: { row: IntegrationRow; onConfigure: () => void }) {
  const styles = row.status === 'CONNECTED'
    ? { wrap: 'border-success/40 bg-success/5',  icon: 'bg-success/15 text-success',         Icon: CheckCircle2,  label: 'Connected', badge: 'success' as const }
    : row.status === 'FAILED'
    ? { wrap: 'border-destructive/40 bg-destructive/5', icon: 'bg-destructive/15 text-destructive', Icon: AlertTriangle, label: 'Test failed', badge: 'destructive' as const }
    : { wrap: 'border-border', icon: 'bg-muted text-muted-foreground', Icon: CircleSlash, label: 'Not configured', badge: 'muted' as const };

  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${styles.wrap}`}>
      <div className="flex items-start gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${styles.icon}`}>
          <styles.Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{row.title}</span>
            <Badge variant={styles.badge} className="text-[10px]">{styles.label}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{row.vendor}</p>

          {row.summary && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {Object.entries(row.summary).slice(0, 4).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground capitalize">{k}</dt>
                  <dd className="font-mono truncate" title={String(v)}>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}

          {row.lastError && row.status === 'FAILED' && (
            <div className="mt-2 rounded-md bg-destructive/10 text-destructive text-[11px] p-2 border border-destructive/20">
              <Info className="size-3 inline mr-1" />
              {row.lastError}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">
              {row.lastTestedAt
                ? `Last tested ${new Date(row.lastTestedAt).toLocaleString()}`
                : 'Never tested'}
            </div>
            <Button size="sm" variant={row.status === 'CONNECTED' ? 'outline' : 'default'} onClick={onConfigure}>
              <Settings className="size-3.5" /> {row.status === 'CONNECTED' ? 'Manage' : 'Configure'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
