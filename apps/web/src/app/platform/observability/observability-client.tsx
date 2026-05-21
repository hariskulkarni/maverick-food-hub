'use client';
/**
 * Super-admin observability dashboard.
 *
 *   Overview tab – overall status banner, run-checks button, KPI cards,
 *     dependency probe grid (grouped by category), system resource panel,
 *     and a per-area error breakdown. Auto-refreshes every 20s.
 *   Errors tab  – filterable + searchable error feed with inline
 *     resolve/reopen and an expandable digest + stack trace.
 *
 * All data is fetched client-side from /api/platform/observability/*. The
 * /platform layout enforces super-admin auth, so we just consume the APIs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relTime } from '@/lib/utils';
import {
  Activity, RefreshCw, Loader2, Search, AlertTriangle, AlertCircle,
  Info, CheckCircle2, XCircle, HelpCircle, Cpu, HardDrive, Gauge, Clock,
  ChevronRight
} from 'lucide-react';

// ─── types ───────────────────────────────────────────────────────────────────

type Status = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
type Level = 'ERROR' | 'WARN' | 'INFO';

interface Probe {
  target: string;
  category: string;
  label: string;
  status: Status;
  latencyMs: number | null;
  detail: string | null;
  meta: Record<string, unknown> | null;
  consecutiveFailures: number;
  checkedAt: string;
}

interface RecentError {
  id: string;
  level: Level;
  source: string;
  message: string;
  path: string | null;
  count: number;
  statusCode: number | null;
  lastSeenAt: string;
}

interface AreaSummary {
  key: string;
  label: string;
  errorCount: number;
  lastErrorAt: string | null;
  status: Status;
}

interface SystemMeta {
  memoryUsedPct?: number | null;
  totalMemMB?: number | null;
  freeMemMB?: number | null;
  cpuCount?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  diskUsedPct?: number | null;
  osUptimeSec?: number | null;
}

interface Overview {
  generatedAt: string;
  overall: Status;
  probes: Probe[];
  errors: {
    totalUnresolved: number;
    last24h: number;
    byLevel: { ERROR?: number; WARN?: number; INFO?: number };
    recent: RecentError[];
  };
  areas: AreaSummary[];
  system: SystemMeta | null;
}

interface ErrorRow {
  id: string;
  level: Level;
  source: string;
  message: string;
  digest: string | null;
  sampleStack: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  area: string | null;
}

interface ErrorsResponse {
  rows: ErrorRow[];
  total: number;
  areas: { key: string; label: string }[];
}

// ─── status helpers ────────────────────────────────────────────────────────────

function statusBadgeVariant(s: Status): 'success' | 'warning' | 'destructive' | 'muted' {
  switch (s) {
    case 'UP': return 'success';
    case 'DEGRADED': return 'warning';
    case 'DOWN': return 'destructive';
    default: return 'muted';
  }
}

function statusDotClass(s: Status): string {
  switch (s) {
    case 'UP': return 'bg-success';
    case 'DEGRADED': return 'bg-warning';
    case 'DOWN': return 'bg-destructive';
    default: return 'bg-muted-foreground/40';
  }
}

function statusLabel(s: Status): string {
  switch (s) {
    case 'UP': return 'Operational';
    case 'DEGRADED': return 'Degraded';
    case 'DOWN': return 'Outage';
    default: return 'Unknown';
  }
}

function bannerClass(s: Status): string {
  switch (s) {
    case 'UP': return 'bg-success/10 border-success/30 text-success';
    case 'DEGRADED': return 'bg-warning/10 border-warning/30 text-warning';
    case 'DOWN': return 'bg-destructive/10 border-destructive/30 text-destructive';
    default: return 'bg-muted border-border text-muted-foreground';
  }
}

function levelBadgeVariant(l: Level): 'destructive' | 'warning' | 'default' {
  switch (l) {
    case 'ERROR': return 'destructive';
    case 'WARN': return 'warning';
    default: return 'default';
  }
}

function safeRelTime(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '—';
  return relTime(d);
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtUptime(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── root ───────────────────────────────────────────────────────────────────

export function ObservabilityClient() {
  const [tab, setTab] = useState<'overview' | 'errors'>('overview');

  return (
    <>
      <div className="flex items-center gap-1 border-b">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'errors'} onClick={() => setTab('errors')}>Errors</TabButton>
      </div>
      {tab === 'overview' ? <OverviewTab /> : <ErrorsTab />}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ─── overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/platform/observability/overview', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as Overview;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  async function runChecks() {
    setRunning(true);
    try {
      await fetch('/api/platform/observability/run-checks', { method: 'POST', credentials: 'same-origin' });
      await load();
    } catch {
      /* surfaced via the error banner on next load */
    } finally {
      setRunning(false);
    }
  }

  if (loading && !data) {
    return <div className="flex items-center gap-2 py-16 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading platform health…</div>;
  }

  if (error && !data) {
    return (
      <Card className="mt-6">
        <CardContent className="p-8 text-center text-sm text-destructive">
          Could not load observability data: {error}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const overall = data.overall ?? 'UNKNOWN';
  const errors = data.errors ?? { totalUnresolved: 0, last24h: 0, byLevel: {}, recent: [] };
  const byLevel = errors.byLevel ?? {};
  const probes = data.probes ?? [];
  const areas = data.areas ?? [];

  // Group probes by category, preserving first-seen order.
  const grouped = new Map<string, Probe[]>();
  for (const p of probes) {
    const k = p.category || 'Other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(p);
  }

  return (
    <div className="space-y-6 pt-6">
      {/* overall banner */}
      <div className={`flex flex-wrap items-center gap-4 rounded-xl border p-5 ${bannerClass(overall)}`}>
        <div className={`flex size-3 shrink-0 rounded-full ${statusDotClass(overall)} ${overall === 'DOWN' || overall === 'DEGRADED' ? 'animate-pulse' : ''}`} />
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="size-5" /> {statusLabel(overall)}
          </div>
          <div className="text-xs opacity-80 mt-0.5">
            Last checked {safeRelTime(data.generatedAt)}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={runChecks} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Run checks now
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Unresolved errors" value={errors.totalUnresolved ?? 0} tone={(errors.totalUnresolved ?? 0) > 0 ? 'destructive' : 'muted'} icon={<AlertCircle className="size-4" />} />
        <Kpi label="Errors (24h)" value={errors.last24h ?? 0} tone={(errors.last24h ?? 0) > 0 ? 'warning' : 'muted'} icon={<Clock className="size-4" />} />
        <Kpi label="Error level" value={byLevel.ERROR ?? 0} tone="destructive" icon={<XCircle className="size-4" />} />
        <Kpi label="Warn level" value={byLevel.WARN ?? 0} tone="warning" icon={<AlertTriangle className="size-4" />} />
      </div>

      {/* probes */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Dependency probes</h2>
        {grouped.size === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No probes configured.</CardContent></Card>
        ) : (
          Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{category}</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p) => (
                  <Card key={p.target}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`size-2.5 shrink-0 rounded-full ${statusDotClass(p.status)}`} />
                          <span className="font-medium text-sm truncate">{p.label || p.target}</span>
                        </div>
                        <Badge variant={statusBadgeVariant(p.status)} className="text-[10px] shrink-0">{p.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">{p.latencyMs == null ? '— ms' : `${p.latencyMs} ms`}</span>
                        {p.consecutiveFailures > 0 && (
                          <span className="text-destructive">{p.consecutiveFailures} fail{p.consecutiveFailures === 1 ? '' : 's'}</span>
                        )}
                        <span className="ml-auto">{safeRelTime(p.checkedAt)}</span>
                      </div>
                      {p.detail && <div className="text-xs text-muted-foreground break-words">{p.detail}</div>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* system panel */}
      <SystemPanel system={data.system} />

      {/* areas */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Areas</h2>
        {areas.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No areas reported.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {areas.map((a) => (
              <Card key={a.key}>
                <CardContent className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{a.label || a.key}</span>
                    <span className={`size-2.5 shrink-0 rounded-full ${statusDotClass(a.status)}`} />
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">{a.errorCount ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {(a.errorCount ?? 0) === 0 ? 'No errors' : `Last ${safeRelTime(a.lastErrorAt)}`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, tone, icon }: { label: string; value: number; tone: 'destructive' | 'warning' | 'muted'; icon: React.ReactNode }) {
  const toneClass =
    tone === 'destructive' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' :
    'text-muted-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <span className={toneClass}>{icon}</span> {label}
        </div>
        <div className={`mt-1.5 text-3xl font-semibold tabular-nums ${value > 0 ? toneClass : 'text-foreground'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function SystemPanel({ system }: { system: SystemMeta | null }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">System</h2>
      <Card>
        <CardContent className="p-5">
          {!system ? (
            <div className="text-sm text-muted-foreground">No system metrics available.</div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <UsageBar
                  icon={<Gauge className="size-4" />}
                  label="Memory used"
                  pct={system.memoryUsedPct ?? null}
                  caption={system.totalMemMB != null ? `${fmtNum(system.totalMemMB)} MB total · ${fmtNum(system.freeMemMB)} MB free` : null}
                />
                <UsageBar
                  icon={<HardDrive className="size-4" />}
                  label="Disk used"
                  pct={system.diskUsedPct ?? null}
                  caption={null}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 content-start">
                <Stat icon={<Cpu className="size-4" />} label="CPU cores" value={fmtNum(system.cpuCount)} />
                <Stat icon={<Clock className="size-4" />} label="Uptime" value={fmtUptime(system.osUptimeSec)} />
                <Stat
                  icon={<Activity className="size-4" />}
                  label="Load avg"
                  value={`${fmtNum(system.load1, 2)} / ${fmtNum(system.load5, 2)} / ${fmtNum(system.load15, 2)}`}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function UsageBar({ icon, label, pct, caption }: { icon: React.ReactNode; label: string; pct: number | null; caption: string | null }) {
  const clamped = pct == null || Number.isNaN(pct) ? null : Math.max(0, Math.min(100, pct));
  const barClass = clamped == null ? 'bg-muted-foreground/30' : clamped >= 90 ? 'bg-destructive' : clamped >= 75 ? 'bg-warning' : 'bg-success';
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">{icon} {label}</span>
        <span className="font-medium tabular-nums">{clamped == null ? '—' : `${clamped.toFixed(0)}%`}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${clamped ?? 0}%` }} />
      </div>
      {caption && <div className="mt-1 text-[11px] text-muted-foreground">{caption}</div>}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{icon} {label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ─── errors tab ────────────────────────────────────────────────────────────────

function ErrorsTab() {
  const [level, setLevel] = useState<'ALL' | Level>('ALL');
  const [resolved, setResolved] = useState<'false' | 'true' | 'all'>('false');
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');

  const [data, setData] = useState<ErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (level !== 'ALL') sp.set('level', level);
      if (resolved !== 'all') sp.set('resolved', resolved);
      if (area) sp.set('area', area);
      if (q.trim()) sp.set('q', q.trim());
      sp.set('limit', '100');
      const r = await fetch(`/api/platform/observability/errors?${sp.toString()}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as ErrorsResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load errors');
    } finally {
      setLoading(false);
    }
  }, [level, resolved, area, q]);

  // Debounce loads (covers the text search and dropdown changes alike).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  async function toggleResolved(row: ErrorRow) {
    setBusyId(row.id);
    try {
      const r = await fetch(`/api/platform/observability/errors/${row.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ resolved: !row.resolvedAt })
      });
      if (r.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  const rows = data?.rows ?? [];
  const areas = data?.areas ?? [];

  const levelOpts: ('ALL' | Level)[] = ['ALL', 'ERROR', 'WARN', 'INFO'];

  const countLabel = useMemo(() => {
    const total = data?.total ?? rows.length;
    return `${rows.length}${total > rows.length ? ` of ${total}` : ''} row${rows.length === 1 ? '' : 's'}`;
  }, [data, rows.length]);

  return (
    <div className="space-y-4 pt-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message, source, or path" className="pl-9" />
            </div>
            <select value={level} onChange={(e) => setLevel(e.target.value as 'ALL' | Level)} className="h-9 rounded-md border bg-card px-2 text-sm">
              {levelOpts.map((l) => <option key={l} value={l}>{l === 'ALL' ? 'All levels' : l}</option>)}
            </select>
            <select value={resolved} onChange={(e) => setResolved(e.target.value as 'false' | 'true' | 'all')} className="h-9 rounded-md border bg-card px-2 text-sm">
              <option value="false">Unresolved</option>
              <option value="true">Resolved</option>
              <option value="all">All</option>
            </select>
            <select value={area} onChange={(e) => setArea(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm">
              <option value="">All areas</option>
              {areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{countLabel}</span>
              <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Level</Th>
                  <Th>Where</Th>
                  <Th>Message</Th>
                  <Th>Area</Th>
                  <Th align="right">Count</Th>
                  <Th>Last seen</Th>
                  <Th align="right">Code</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {error && (
                  <tr><td colSpan={8} className="p-12 text-center text-destructive">{error}</td></tr>
                )}
                {!error && loading && rows.length === 0 && (
                  <tr><td colSpan={8} className="p-12 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> Loading…</td></tr>
                )}
                {!error && !loading && rows.length === 0 && (
                  <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">No errors match these filters.</td></tr>
                )}
                {rows.map((row) => {
                  const isOpen = expanded === row.id;
                  return (
                    <ErrorTableRows
                      key={row.id}
                      row={row}
                      isOpen={isOpen}
                      busy={busyId === row.id}
                      onToggleExpand={() => setExpanded(isOpen ? null : row.id)}
                      onToggleResolved={() => toggleResolved(row)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorTableRows({
  row, isOpen, busy, onToggleExpand, onToggleResolved
}: {
  row: ErrorRow;
  isOpen: boolean;
  busy: boolean;
  onToggleExpand: () => void;
  onToggleResolved: () => void;
}) {
  const LevelIcon = row.level === 'ERROR' ? XCircle : row.level === 'WARN' ? AlertTriangle : Info;
  return (
    <>
      <tr className="hover:bg-muted/30 cursor-pointer align-top" onClick={onToggleExpand}>
        <td className="px-4 py-3">
          <Badge variant={levelBadgeVariant(row.level)} className="text-[10px] gap-1">
            <LevelIcon className="size-3" /> {row.level}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs">
          <div className="font-mono truncate max-w-[160px]">{row.source || '—'}</div>
          {row.path && <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]">{row.method ? `${row.method} ` : ''}{row.path}</div>}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            <span className="truncate max-w-[360px]" title={row.message}>{row.message || '(no message)'}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{row.area || '—'}</td>
        <td className="px-4 py-3 text-right tabular-nums">{row.count ?? 0}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{safeRelTime(row.lastSeenAt)}</td>
        <td className="px-4 py-3 text-right text-xs font-mono">{row.statusCode ?? '—'}</td>
        <td className="px-4 py-3 text-right">
          <Button
            size="sm"
            variant={row.resolvedAt ? 'outline' : 'ghost'}
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onToggleResolved(); }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : row.resolvedAt ? <HelpCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {row.resolvedAt ? 'Reopen' : 'Resolve'}
          </Button>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-muted/20">
          <td colSpan={8} className="px-4 py-3">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Meta label="First seen" value={safeRelTime(row.firstSeenAt)} />
                <Meta label="Last seen" value={safeRelTime(row.lastSeenAt)} />
                <Meta label="Resolved" value={row.resolvedAt ? safeRelTime(row.resolvedAt) : 'Open'} />
                <Meta label="Status code" value={row.statusCode != null ? String(row.statusCode) : '—'} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Digest</div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all rounded bg-card border p-2">{row.digest || '(none)'}</pre>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sample stack</div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-[360px] overflow-y-auto rounded bg-card border p-2">{row.sampleStack || '(no stack captured)'}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── small bits ─────────────────────────────────────────────────────────────

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
