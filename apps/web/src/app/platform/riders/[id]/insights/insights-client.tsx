'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, Battery, BatteryCharging, Clock, Download, Loader2, MapPin, Pause, Play, RefreshCw,
  Route, Signal, ShieldAlert, ShieldCheck, Smartphone, Wifi, WifiOff,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatIst } from '@/lib/ist';
import { reportApiError } from '@/lib/api-error';
import type { RiderInsightsDTO } from '@/server/rider-insights/service';

const InsightsMap = dynamic(() => import('./insights-map'), {
  ssr: false,
  loading: () => <div className="grid h-[280px] place-items-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">Loading map…</div>,
});

type WindowStats = RiderInsightsDTO['stats']['today'];
interface PathPoint { lat: number; lng: number; t: number; speedKph: number | null }
interface PathData {
  kind: 'delivery' | 'shift';
  orderCode?: string;
  pickup: { lat: number; lng: number } | null;
  drop: { lat: number; lng: number } | null;
  summary: {
    pointCount: number; droppedPoints: number; distanceM: number; durationSec: number; movingSec: number;
    maxGapSec: number; gapCount: number; startedAt: string | null; endedAt: string | null;
  };
  points: PathPoint[];
}

const EVENT_LABEL: Record<string, string> = {
  ONLINE: 'Went online',
  OFFLINE: 'Went offline',
  AUTO_OFFLINE: 'Auto-offline (app silent)',
  SIGNAL_LOST: 'Signal lost on delivery',
  SIGNAL_REGAINED: 'Signal regained',
};
const SOURCE_LABEL: Record<string, string> = {
  rider: 'rider toggle',
  logout: 'signed out',
  kyc_expiry: 'KYC expired',
  heartbeat_sweep: 'heartbeat check',
  heartbeat: 'heartbeat',
  location: 'location ping',
};
const EXPORTS = [
  { kind: 'timeline', label: 'Online/offline timeline' },
  { kind: 'deliveries', label: 'Deliveries + distance' },
  { kind: 'breadcrumbs', label: 'GPS breadcrumbs' },
  { kind: 'device', label: 'Device / network / battery' },
] as const;

const ist = (iso: string | null | undefined) => (iso ? formatIst(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const istTime = (ms: number) => formatIst(new Date(ms), { timeStyle: 'medium' });

function duration(ms: number): string {
  if (!ms || ms < 60_000) return ms > 0 ? '<1m' : '0m';
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const km = (m: number) => `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function InsightsClient({ riderId }: { riderId: string }) {
  const [data, setData] = useState<RiderInsightsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'today' | 'week'>('today');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/platform/riders/${riderId}/insights`, { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load rider insights'); return; }
      setData(await r.json());
    } catch {
      toast.error('Could not load rider insights — check your connection.');
    } finally {
      setLoading(false);
    }
  }, [riderId]);
  useEffect(() => { void load(); }, [load]);

  if (!data) {
    return (
      <div className="grid h-60 place-items-center">
        {loading ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <Button onClick={load}>Retry</Button>}
      </div>
    );
  }

  const { rider, status, device } = data;
  const stats = range === 'today' ? data.stats.today : data.stats.week;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/riders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Riders
          </Link>
          <h1 className="display mt-1 truncate text-2xl font-semibold sm:text-3xl">{rider.name ?? rider.phone ?? 'Rider'}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{rider.phone}</span> · {rider.vehicleType} {rider.vehicleNumber ?? ''}
            {rider.branch ? ` · ${rider.branch}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge isOnline={status.isOnline} signalLost={status.signalLost} />
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-primary" /> Last location</div>
              <div className="text-xs text-muted-foreground">
                GPS fix {ago(data.lastLocation?.at ?? status.lastLocationAt)} · app seen {ago(status.lastSeenAt)}
                {status.gpsEnabled === false && <span className="ml-1 text-destructive">· phone GPS off</span>}
              </div>
            </div>
            {data.lastLocation ? (
              <InsightsMap rider={{ lat: data.lastLocation.lat, lng: data.lastLocation.lng }} height={280} />
            ) : (
              <div className="grid h-[200px] place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">No location recorded yet.</div>
            )}
            <div className="text-xs text-muted-foreground">
              Last seen {ist(status.lastSeenAt)}
              {data.lastLocation && <> · {data.lastLocation.lat.toFixed(5)}, {data.lastLocation.lng.toFixed(5)}</>}
              {status.signalLostAt && <> · signal lost since {ist(status.signalLostAt)}</>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium"><Smartphone className="size-4 text-primary" /> Device</div>
              {device ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <Field label="Model" value={device.model} />
                  <Field label="OS" value={[device.osName, device.osVersion].filter(Boolean).join(' ') || null} />
                  <Field label="App" value={device.appVersion ? `${device.appVersion}${device.appBuild ? ` (${device.appBuild})` : ''}` : null} />
                  <Field label="Reported" value={ago(device.capturedAt)} />
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">No device info yet. It is reported by the updated rider app while the rider is online.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium"><Signal className="size-4 text-primary" /> Network & battery</div>
              {device ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={device.networkType === 'NONE' ? 'destructive' : 'muted'} className="gap-1">
                    {device.networkType === 'WIFI' ? <Wifi className="size-3" /> : device.networkType === 'NONE' ? <WifiOff className="size-3" /> : <Signal className="size-3" />}
                    {networkLabel(device.networkType, device.cellularGeneration)}
                  </Badge>
                  <Badge variant={device.batteryLevel != null && device.batteryLevel <= 15 && !device.charging ? 'destructive' : 'muted'} className="gap-1">
                    {device.charging ? <BatteryCharging className="size-3" /> : <Battery className="size-3" />}
                    {device.batteryLevel != null ? `${device.batteryLevel}%` : 'Battery —'}
                    {device.charging ? ' · charging' : ''}
                  </Badge>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
              {data.deviceHistory.length > 0 && (
                <ul className="max-h-36 divide-y overflow-auto rounded-md border text-[11px]">
                  {data.deviceHistory.map((h) => (
                    <li key={h.at} className="flex items-center justify-between gap-2 px-2 py-1">
                      <span className="text-muted-foreground">{ist(h.at)}</span>
                      <span>{networkLabel(h.networkType, h.cellularGeneration)} · {h.batteryLevel != null ? `${h.batteryLevel}%` : '—'}{h.charging ? ' ⚡' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {data.integrity && <IntegritySection integrity={data.integrity} />}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium"><Clock className="size-4 text-primary" /> Activity</div>
            <div className="flex gap-1">
              <Chip active={range === 'today'} onClick={() => setRange('today')}>Today</Chip>
              <Chip active={range === 'week'} onClick={() => setRange('week')}>Last 7 days</Chip>
            </div>
          </div>
          <StatsGrid s={stats} />
          {data.stats.pingsTruncated && <p className="text-[11px] text-warning">Distance uses the first 60,000 GPS points of the week.</p>}
          <p className="text-[11px] text-muted-foreground">
            Online time comes from recorded online/offline events; distance and average speed from the GPS trail (jumps and parked-phone jitter removed). Idle = online but not on an accepted delivery.
          </p>
        </CardContent>
      </Card>

      <PathPanel riderId={riderId} deliveries={data.deliveries} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="font-medium">Online / offline timeline (7 days)</div>
            {data.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No status changes recorded in the last 7 days.</p>
            ) : (
              <ol className="max-h-96 space-y-1 overflow-auto text-sm">
                {data.timeline.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${eventDot(e.type)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</div>
                      <div className="text-[11px] text-muted-foreground">{ist(e.at)}{e.source ? ` · ${SOURCE_LABEL[e.source] ?? e.source}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-medium"><Download className="size-4 text-primary" /> CSV export (last 7 days)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXPORTS.map((x) => (
                <a
                  key={x.kind}
                  href={`/api/platform/riders/${riderId}/insights/export?kind=${x.kind}`}
                  className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"
                >
                  <Download className="size-4 shrink-0" /> <span className="truncate">{x.label}</span>
                </a>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Exports are audited. GPS breadcrumbs and device history are kept for 90 and 30 days; collected only while the rider is online, as disclosed in the rider app.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PathPanel({ riderId, deliveries }: { riderId: string; deliveries: RiderInsightsDTO['deliveries'] }) {
  const [path, setPath] = useState<PathData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function open(key: string, url: string) {
    setBusy(true);
    setSelected(key);
    setPlaying(false);
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load the path'); return; }
      const p: PathData = await r.json();
      setPath(p);
      setIdx(Math.max(0, p.points.length - 1));
    } catch {
      toast.error('Could not load the path — check your connection.');
    } finally {
      setBusy(false);
    }
  }

  const openShift = () => {
    const now = new Date();
    const from = new Date(now.getTime() - 12 * 3_600_000);
    void open('shift', `/api/platform/riders/${riderId}/insights/path?from=${from.toISOString()}&to=${now.toISOString()}`);
  };

  const points = useMemo(() => path?.points ?? [], [path]);
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(points.length / 300));
    timer.current = setInterval(() => setIdx((i) => Math.min(points.length - 1, i + step)), 80);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, points.length]);
  useEffect(() => {
    if (playing && idx >= points.length - 1) setPlaying(false);
  }, [playing, idx, points.length]);

  const line = useMemo(() => points.map((p) => ({ lat: p.lat, lng: p.lng })), [points]);
  const cur = points[idx] ?? null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium"><Route className="size-4 text-primary" /> Travel paths</div>
          <Button variant="outline" size="sm" onClick={openShift} disabled={busy}>Last 12 h shift path</Button>
        </div>

        {path && (
          <div className="space-y-2">
            <InsightsMap path={line} cursor={cur ? { lat: cur.lat, lng: cur.lng } : null} pickup={path.pickup} drop={path.drop} height={340} />
            {points.length > 1 ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={playing ? 'Pause' : 'Play'}
                  onClick={() => { if (!playing && idx >= points.length - 1) setIdx(0); setPlaying((v) => !v); }}
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={points.length - 1}
                  value={idx}
                  onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
                  className="h-2 w-full min-w-0 flex-1 accent-primary"
                  aria-label="Playback position"
                />
                <div className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {cur ? istTime(cur.t) : ''}
                  {cur?.speedKph != null && <div className="text-muted-foreground">{Math.round(cur.speedKph)} km/h</div>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No GPS points recorded for this {path.kind === 'delivery' ? 'delivery' : 'period'}.</p>
            )}
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
              <Mini label={path.kind === 'delivery' ? `Order ${path.orderCode ?? ''}` : 'Shift'} value={km(path.summary.distanceM)} />
              <Mini label="Duration" value={duration(path.summary.durationSec * 1000)} />
              <Mini label="Moving" value={duration(path.summary.movingSec * 1000)} />
              <Mini label="Max GPS gap" value={duration(path.summary.maxGapSec * 1000)} />
              <Mini label="Points" value={`${path.summary.pointCount}${path.summary.droppedPoints ? ` (−${path.summary.droppedPoints})` : ''}`} />
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-2">Order</th>
                <th className="py-2 pr-2">Status</th>
                <th className="hidden py-2 pr-2 sm:table-cell">Accepted</th>
                <th className="py-2 pr-2">Distance</th>
                <th className="py-2 pr-2">Duration</th>
                <th className="hidden py-2 pr-2 sm:table-cell">Max gap</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {deliveries.map((d) => (
                <tr key={d.assignmentId} className={selected === d.assignmentId ? 'bg-primary/5' : ''}>
                  <td className="py-2 pr-2">
                    <div className="font-mono text-xs">{d.orderCode}</div>
                    {d.branch && <div className="max-w-[160px] truncate text-[11px] text-muted-foreground">{d.branch}</div>}
                  </td>
                  <td className="py-2 pr-2"><Badge variant={d.status === 'DELIVERED' ? 'success' : 'muted'} className="text-[10px]">{d.status}</Badge></td>
                  <td className="hidden py-2 pr-2 text-xs sm:table-cell">{ist(d.acceptedAt)}</td>
                  <td className="py-2 pr-2 text-xs">{d.summary ? km(d.summary.distanceM) : '—'}</td>
                  <td className="py-2 pr-2 text-xs">{d.summary ? duration(d.summary.durationSec * 1000) : '—'}</td>
                  <td className="hidden py-2 pr-2 text-xs sm:table-cell">{d.summary ? duration(d.summary.maxGapSec * 1000) : '—'}</td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => open(d.assignmentId, `/api/platform/riders/${riderId}/insights/path?assignmentId=${d.assignmentId}`)}
                    >
                      {busy && selected === d.assignmentId ? <Loader2 className="animate-spin" /> : <Play />} Path
                    </Button>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No deliveries in the last 7 days.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StatsGrid({ s }: { s: WindowStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Mini label="Online" value={duration(s.onlineMs)} />
      <Mini label="Deliveries" value={String(s.deliveries)} />
      <Mini label="Distance" value={km(s.distanceM)} />
      <Mini label="Avg speed" value={s.avgSpeedKph ? `${s.avgSpeedKph} km/h` : '—'} />
      <Mini label="Idle" value={duration(s.idleMs)} />
      <Mini label="Signal lost" value={`${s.signalLost + s.autoOffline}`} hint={`${s.signalLost} on delivery · ${s.autoOffline} auto-offline`} />
    </div>
  );
}

function StatusBadge({ isOnline, signalLost }: { isOnline: boolean; signalLost: boolean }) {
  if (isOnline && signalLost) return <Badge variant="warning">Online · signal lost</Badge>;
  return <Badge variant={isOnline ? 'success' : 'muted'}>{isOnline ? 'Online' : 'Offline'}</Badge>;
}

function networkLabel(type: string | null, gen: string | null): string {
  if (!type) return 'Network —';
  if (type === 'CELLULAR') return gen ? `Mobile data ${gen.toUpperCase()}` : 'Mobile data';
  if (type === 'WIFI') return 'Wi-Fi';
  if (type === 'NONE') return 'No connection';
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function eventDot(type: string): string {
  switch (type) {
    case 'ONLINE': return 'bg-success';
    case 'SIGNAL_REGAINED': return 'bg-primary';
    case 'SIGNAL_LOST': return 'bg-warning';
    case 'AUTO_OFFLINE': return 'bg-destructive';
    default: return 'bg-muted-foreground';
  }
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value ?? '—'}</dd>
    </>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-card p-2" title={hint}>
      <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
    >
      {children}
    </button>
  );
}

type IntegrityData = NonNullable<RiderInsightsDTO['integrity']>;

const VERDICT_LABEL: Record<string, string> = {
  MEETS_DEVICE_INTEGRITY: 'Device integrity OK',
  MEETS_BASIC_INTEGRITY: 'Basic integrity only',
  FAILED: 'Integrity FAILED',
  UNEVALUATED: 'Not evaluated',
};

/**
 * Location integrity (anti-fraud): mock-ping count, spoof suspicion events and
 * the Google Play Integrity device-attestation verdict. Read-only here; review
 * actions live on the /platform/rider-integrity queue.
 */
function IntegritySection({ integrity }: { integrity: IntegrityData }) {
  const flagged = integrity.status === 'FLAGGED';
  const verdictFailed = integrity.integrity.verdict === 'FAILED';
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            {flagged ? <ShieldAlert className="size-4 text-destructive" /> : <ShieldCheck className="size-4 text-primary" />}
            Location integrity
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={flagged ? 'destructive' : integrity.status === 'CLEARED' ? 'muted' : 'muted'}>{integrity.status}</Badge>
            {integrity.offersPaused && <Badge variant="destructive">Offers paused</Badge>}
            {flagged && (
              <Button asChild size="sm" variant="outline">
                <Link href="/platform/rider-integrity">Review queue</Link>
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Mock pings (shift)" value={String(integrity.shift.mockPingCount)} />
          <Mini label="Spoof events" value={String(integrity.shift.spoofEventCount)} />
          <Mini label="Suspicion score" value={String(integrity.shift.spoofScore)} />
          <Mini
            label="Device integrity"
            value={integrity.integrity.configured ? (VERDICT_LABEL[integrity.integrity.verdict] ?? integrity.integrity.verdict) : 'Not configured'}
            hint={integrity.integrity.detail ?? undefined}
          />
        </div>

        {integrity.flagged && (
          <p className="text-xs text-muted-foreground">
            Flagged {ist(integrity.flagged.at)}
            {integrity.flagged.reason ? ` · ${integrity.flagged.reason}` : ''}
            {integrity.review ? ` · reviewed ${ist(integrity.review.at)}` : ''}
          </p>
        )}
        {!integrity.integrity.configured && (
          <p className="text-[11px] text-muted-foreground">
            Play Integrity device attestation is not configured (PLAY_INTEGRITY_* env). Mock-GPS and movement heuristics still run; device attestation shows &quot;Not configured&quot; and nothing is blocked.
          </p>
        )}

        {integrity.events.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Recent incidents</div>
            <ul className="divide-y rounded-md border text-xs">
              {integrity.events.slice(0, 10).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="min-w-0">
                    <span className={`font-medium ${e.kind === 'MOCK_FLAG' || e.kind === 'INTEGRITY_FAILED' ? 'text-destructive' : ''}`}>{e.kind}</span>
                    <span className="text-muted-foreground"> · {e.reason}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{ist(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No suspicious location signals recorded.{verdictFailed ? '' : ' Fraud prevention on operational location only — never the rider’s personal phone use.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
