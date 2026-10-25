'use client';
/**
 * Shared building blocks for the Observability Center tabs: data hook, status
 * pills, KPI tiles, compact charts, responsive tables, formatters.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2, AlertTriangle } from 'lucide-react';

export type RangeKey = '15m' | '1h' | '24h' | '7d';

// ─── data hook ───────────────────────────────────────────────────────────────

export function useObs<T>(url: string | null, refreshKey: number): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bump, setBump] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!url) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    fetch(url, { cache: 'no-store', signal: c.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Request failed (${r.status})`);
        }
        return r.json() as Promise<T>;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (ctrl.current === c) setLoading(false);
      });
    return () => c.abort();
  }, [url, refreshKey, bump]);
  const reload = useCallback(() => setBump((b) => b + 1), []);
  return { data, error, loading, reload };
}

export async function postJson(url: string, body: unknown, method = 'POST'): Promise<unknown> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error || `Request failed (${r.status})`);
  return j;
}

// ─── formatters ──────────────────────────────────────────────────────────────

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
export const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
export const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function fmtMin(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}
export function fmtTime(iso: string, range: RangeKey): string {
  const d = new Date(iso);
  return range === '7d'
    ? d.toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ─── status ──────────────────────────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
const TONE_BADGE: Record<Tone, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'destructive',
  muted: 'muted',
  info: 'default',
};

export function toneFor(status: string | null | undefined): Tone {
  switch ((status ?? '').toUpperCase()) {
    case 'UP':
    case 'OK':
    case 'SUCCESS':
    case 'HEALTHY':
    case 'SENT':
    case 'RESOLVED':
      return 'ok';
    case 'DEGRADED':
    case 'WARNING':
    case 'RUNNING':
    case 'NEVER':
    case 'FAILING':
      return 'warn';
    case 'DOWN':
    case 'CRITICAL':
    case 'FAILED':
    case 'OVERDUE':
    case 'FIRING':
      return 'bad';
    case 'UNKNOWN':
    case 'UNSCHEDULED':
      return 'muted';
    default:
      return 'info';
  }
}

export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={TONE_BADGE[toneFor(status)]} className={cn('whitespace-nowrap', className)}>
      {label ?? status}
    </Badge>
  );
}

// ─── layout pieces ───────────────────────────────────────────────────────────

export function Kpi({ label, value, sub, tone = 'info', onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void }) {
  const ring = tone === 'bad' ? 'border-destructive/40' : tone === 'warn' ? 'border-warning/40' : '';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Card className={cn('min-w-0', ring)}>
      <Comp onClick={onClick} className={cn('block w-full text-left p-4', onClick && 'hover:bg-muted/40 rounded-xl')}>
        <div className="text-xs uppercase tracking-wide text-muted-foreground truncate">{label}</div>
        <div className={cn('mt-1 text-2xl font-semibold tabular-nums truncate', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-warning')}>{value}</div>
        {sub ? <div className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</div> : null}
      </Comp>
    </Card>
  );
}

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold text-sm sm:text-base">{title}</h3>
          {actions}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export const th = 'text-left font-medium text-muted-foreground text-xs uppercase tracking-wide py-2 pr-3 whitespace-nowrap';
export const td = 'py-2 pr-3 align-top';

export function LoadState({ loading, error, empty, children }: { loading: boolean; error: string | null; empty?: boolean; children: ReactNode }) {
  if (error)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  if (loading && empty)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  return <>{children}</>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</div>;
}

// ─── charts ──────────────────────────────────────────────────────────────────

export function TrafficChart({ data, range }: { data: Array<{ t: string; count: number; s5xx: number; s4xx: number }>; range: RangeKey }) {
  if (!data.length) return <Empty>No traffic recorded in this range yet.</Empty>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v, range)} minTickGap={32} fontSize={11} />
          <YAxis allowDecimals={false} fontSize={11} />
          <Tooltip labelFormatter={(v) => new Date(String(v)).toLocaleString('en-IN')} />
          <Area type="monotone" dataKey="count" name="Requests" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
          <Area type="monotone" dataKey="s4xx" name="4xx" stroke="hsl(var(--warning))" fill="hsl(var(--warning))" fillOpacity={0.15} />
          <Area type="monotone" dataKey="s5xx" name="5xx" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.25} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencyChart({ data, range }: { data: Array<{ t: string; p50: number | null; p95: number | null; p99: number | null }>; range: RangeKey }) {
  if (!data.some((d) => d.p95 !== null)) return <Empty>No latency samples in this range yet.</Empty>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v, range)} minTickGap={32} fontSize={11} />
          <YAxis fontSize={11} unit="ms" />
          <Tooltip labelFormatter={(v) => new Date(String(v)).toLocaleString('en-IN')} formatter={(v) => fmtMs(Number(v))} />
          <Line type="monotone" dataKey="p50" name="P50" dot={false} stroke="hsl(var(--success))" connectNulls />
          <Line type="monotone" dataKey="p95" name="P95" dot={false} stroke="hsl(var(--warning))" connectNulls />
          <Line type="monotone" dataKey="p99" name="P99" dot={false} stroke="hsl(var(--destructive))" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CountChart({ data, range, label = 'Count' }: { data: Array<{ t: string; count: number }>; range: RangeKey; label?: string }) {
  if (!data.length) return <Empty>Nothing in this range.</Empty>;
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v, range)} minTickGap={32} fontSize={11} />
          <YAxis allowDecimals={false} fontSize={11} />
          <Tooltip labelFormatter={(v) => new Date(String(v)).toLocaleString('en-IN')} />
          <Area type="monotone" dataKey="count" name={label} stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
