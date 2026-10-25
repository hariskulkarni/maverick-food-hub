'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, RefreshCw, Loader2, Timer, Bike, UtensilsCrossed, Target, Hourglass, Layers, Send, MapPinned, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { reportApiError } from '@/lib/api-error';

interface Pct { p50: number | null; p90: number | null }
interface Kpi {
  orders: number;
  delivered: number;
  assignmentLatencyMin: Pct;
  riderWaitAtRestaurantMin: Pct & { fromArrivalShare: number | null };
  foodWaitingForRiderMin: Pct;
  prepError: { maeMin: number | null; biasMin: number | null; samples: number };
  onTimePct: number | null;
  readyTapRatePct: number | null;
  batchRatePct: number | null;
}
interface Insights {
  range: { from: string; to: string; days: number };
  summary: Kpi;
  inviteAcceptance: { invited: number; accepted: number; declined: number; expired: number; ratePct: number | null };
  ordersPerRiderHour: { value: number | null; riderHours: number; note: string };
  unassignedOver5MinLive: number;
  daily: (Kpi & { day: string })[];
  restaurants: (Kpi & { restaurantId: string; name: string })[];
  zones: { bucketAt: string | null; latest: { h3Cell: string; lat: number | null; lng: number | null; openOrders: number; idleRiders: number; busyRiders: number; gap: number }[] };
}
interface JitCfg { enabled: boolean; bufferMin: number; roadFactor: number; speedKph: number; rangeKm: number; promiseSlaMin: number }

const m = (v: number | null | undefined) => (v == null ? '—' : `${v} min`);
const p = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

export function DispatchInsightsClient({
  initialRange,
  restaurants,
  cities,
}: {
  initialRange: { from: string; to: string };
  restaurants: { id: string; name: string }[];
  cities: string[];
}) {
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [restaurantId, setRestaurantId] = useState('');
  const [city, setCity] = useState('');
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);

  const qs = useCallback(() => {
    const q = new URLSearchParams({ from, to });
    if (restaurantId) q.set('restaurantId', restaurantId);
    if (city) q.set('city', city);
    return q.toString();
  }, [from, to, restaurantId, city]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/platform/dispatch-insights?${qs()}`, { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load dispatch insights'); return; }
      setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="display text-2xl font-semibold">Dispatch insights</h1>
        <p className="text-sm text-muted-foreground">
          Delivery orders placed in the range (IST days). Times are minutes; P50 = median, P90 = slowest 10%.
        </p>
      </header>

      <Card><CardContent className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
          <label className="text-xs font-medium text-muted-foreground">From
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">To
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">Restaurant
            <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">All restaurants</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">City
            <select value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">All cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading} className="flex-1">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href={`/api/platform/dispatch-insights?${qs()}&format=csv`}><Download className="size-4" /> CSV</a>
            </Button>
          </div>
        </div>
      </CardContent></Card>

      {!data && loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && s && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile icon={<AlertTriangle className="size-4" />} label="Unassigned > 5 min (live)" value={String(data.unassignedOver5MinLive)} tone={data.unassignedOver5MinLive > 0 ? 'warn' : 'ok'} />
            <Tile icon={<Timer className="size-4" />} label="Assignment latency" value={m(s.assignmentLatencyMin.p50)} sub={`P90 ${m(s.assignmentLatencyMin.p90)}`} />
            <Tile icon={<Send className="size-4" />} label="Batch invite acceptance" value={p(data.inviteAcceptance.ratePct)} sub={`${data.inviteAcceptance.accepted}/${data.inviteAcceptance.accepted + data.inviteAcceptance.declined + data.inviteAcceptance.expired} answered`} />
            <Tile icon={<Bike className="size-4" />} label="Rider wait at restaurant" value={m(s.riderWaitAtRestaurantMin.p50)} sub={`P90 ${m(s.riderWaitAtRestaurantMin.p90)} · ${p(s.riderWaitAtRestaurantMin.fromArrivalShare)} from arrival tap`} />
            <Tile icon={<UtensilsCrossed className="size-4" />} label="Food waiting for rider" value={m(s.foodWaitingForRiderMin.p50)} sub={`P90 ${m(s.foodWaitingForRiderMin.p90)}`} />
            <Tile icon={<Hourglass className="size-4" />} label="Prep prediction error" value={s.prepError.maeMin == null ? '—' : `±${s.prepError.maeMin} min`} sub={`bias ${m(s.prepError.biasMin)} · ${s.prepError.samples} orders`} />
            <Tile icon={<Target className="size-4" />} label="On time vs promise" value={p(s.onTimePct)} sub={`${s.delivered} delivered of ${s.orders}`} />
            <Tile icon={<Layers className="size-4" />} label="Orders / rider-hour" value={data.ordersPerRiderHour.value == null ? '—' : String(data.ordersPerRiderHour.value)} sub={`${data.ordersPerRiderHour.riderHours} rider-h · batch ${p(s.batchRatePct)} · ready-tap ${p(s.readyTapRatePct)}`} />
          </div>
          <p className="text-xs text-muted-foreground">
            Promise = the order&apos;s ETA when recorded, otherwise placed + the promise SLA below. {data.ordersPerRiderHour.note}
          </p>

          <Section title="By day">
            <KpiTable rows={data.daily.map((d) => ({ key: d.day, label: d.day, k: d }))} />
          </Section>

          {data.restaurants.length > 0 && (
            <Section title="By restaurant (top 50 by orders)">
              <KpiTable rows={data.restaurants.map((r) => ({ key: r.restaurantId, label: r.name, k: r }))} />
            </Section>
          )}

          <ZoneHeat zones={data.zones} onSnapshot={load} />
        </>
      )}

      <JitSettings />
    </div>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <Card className={tone === 'warn' ? 'border-warning' : undefined}><CardContent className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span className="truncate">{label}</span></div>
      <div className={`mt-1 text-xl font-semibold ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </CardContent></Card>
  );
}

function KpiTable({ rows }: { rows: { key: string; label: string; k: Kpi }[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No delivery orders in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-2 pr-3 font-medium"> </th>
            <th className="py-2 pr-3 font-medium text-right">Orders</th>
            <th className="py-2 pr-3 font-medium text-right">Assign P50/P90</th>
            <th className="py-2 pr-3 font-medium text-right">Rider wait P50</th>
            <th className="py-2 pr-3 font-medium text-right">Food wait P50</th>
            <th className="py-2 pr-3 font-medium text-right">Prep ±</th>
            <th className="py-2 pr-3 font-medium text-right">On time</th>
            <th className="py-2 pr-3 font-medium text-right">Ready tap</th>
            <th className="py-2 font-medium text-right">Batch</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ key, label, k }) => (
            <tr key={key}>
              <td className="py-2 pr-3 max-w-[14rem] truncate">{label}</td>
              <td className="py-2 pr-3 text-right">{k.orders}</td>
              <td className="py-2 pr-3 text-right">{k.assignmentLatencyMin.p50 ?? '—'} / {k.assignmentLatencyMin.p90 ?? '—'}</td>
              <td className="py-2 pr-3 text-right">{k.riderWaitAtRestaurantMin.p50 ?? '—'}</td>
              <td className="py-2 pr-3 text-right">{k.foodWaitingForRiderMin.p50 ?? '—'}</td>
              <td className="py-2 pr-3 text-right">{k.prepError.maeMin ?? '—'}</td>
              <td className="py-2 pr-3 text-right">{p(k.onTimePct)}</td>
              <td className="py-2 pr-3 text-right">{p(k.readyTapRatePct)}</td>
              <td className="py-2 text-right">{p(k.batchRatePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ZoneHeat({ zones, onSnapshot }: { zones: Insights['zones']; onSnapshot: () => void }) {
  const [busy, setBusy] = useState(false);
  async function snapshot() {
    setBusy(true);
    try {
      const r = await fetch('/api/platform/jobs/zone-snapshot/run', { method: 'POST' });
      if (!r.ok) { await reportApiError(r, 'Snapshot failed'); return; }
      toast.success('Zone snapshot taken');
      onSnapshot();
    } finally {
      setBusy(false);
    }
  }
  const max = Math.max(1, ...zones.latest.map((z) => Math.abs(z.gap)));
  return (
    <Section title="Zone supply vs demand (H3 res-8, latest 5-min snapshot)">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MapPinned className="size-4" />
        {zones.bucketAt ? <span>Snapshot {new Date(zones.bucketAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span> : <span>No snapshot yet — the 5-minute zone job has not run.</span>}
        <Button size="sm" variant="outline" onClick={snapshot} disabled={busy} className="ml-auto">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Snapshot now
        </Button>
      </div>
      {zones.latest.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-2 pr-3 font-medium">Cell</th>
                <th className="py-2 pr-3 font-medium">Centre</th>
                <th className="py-2 pr-3 font-medium text-right">Open orders</th>
                <th className="py-2 pr-3 font-medium text-right">Idle riders</th>
                <th className="py-2 pr-3 font-medium text-right">Busy riders</th>
                <th className="py-2 font-medium">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {zones.latest.map((z) => (
                <tr key={z.h3Cell}>
                  <td className="py-2 pr-3 font-mono text-xs">{z.h3Cell === 'none' ? 'no GPS fix' : z.h3Cell}</td>
                  <td className="py-2 pr-3 text-xs">
                    {z.lat != null && z.lng != null
                      ? <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${z.lat},${z.lng}`}>{z.lat}, {z.lng}</a>
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right">{z.openOrders}</td>
                  <td className="py-2 pr-3 text-right">{z.idleRiders}</td>
                  <td className="py-2 pr-3 text-right">{z.busyRiders}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-muted">
                        <div className={`h-2 rounded ${z.gap > 0 ? 'bg-destructive' : 'bg-success'}`} style={{ width: `${(Math.abs(z.gap) / max) * 100}%` }} />
                      </div>
                      <span className="text-xs">{z.gap > 0 ? `+${z.gap} short` : z.gap < 0 ? `${-z.gap} spare` : 'balanced'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function JitSettings() {
  const [cfg, setCfg] = useState<JitCfg | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch('/api/platform/dispatch-settings', { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((b) => setCfg(b.jit))
      .catch(() => toast.error('Could not load dispatch settings'));
  }, []);
  async function save(patch: Partial<JitCfg>) {
    setSaving(true);
    try {
      const r = await fetch('/api/platform/dispatch-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!r.ok) { await reportApiError(r, 'Could not save'); return; }
      setCfg((await r.json()).jit);
      toast.success('Dispatch settings saved');
    } finally {
      setSaving(false);
    }
  }
  if (!cfg) return null;
  const num = (key: keyof Omit<JitCfg, 'enabled'>, label: string, step: number) => (
    <label className="text-xs font-medium text-muted-foreground">{label}
      <Input
        type="number"
        step={step}
        defaultValue={cfg[key]}
        className="mt-1"
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== cfg[key]) save({ [key]: v }); }}
      />
    </label>
  );
  return (
    <Section title="JIT rider invitations">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={cfg.enabled} disabled={saving} onCheckedChange={(v) => save({ enabled: v })} aria-label="Enable JIT invitations" />
        <span className="text-sm">{cfg.enabled ? 'On — riders are invited before the food is ready' : 'Off — riders are invited when the kitchen taps Food ready'}</span>
        <Badge variant="muted">platform-wide</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Release = accepted + predicted prep − nearest idle rider&apos;s travel (straight line × road factor ÷ speed) − buffer.
        Released at once when no eligible rider is within range or the promise has no slack. Food ready always releases.
      </p>
      <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-5">
        {num('bufferMin', 'Buffer (min)', 1)}
        {num('roadFactor', 'Road factor', 0.05)}
        {num('speedKph', 'Rider speed (km/h)', 1)}
        {num('rangeKm', 'Rider range (km)', 0.5)}
        {num('promiseSlaMin', 'Promise SLA (min)', 5)}
      </div>
    </Section>
  );
}
