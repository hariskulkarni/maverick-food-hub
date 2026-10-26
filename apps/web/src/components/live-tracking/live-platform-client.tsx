'use client';
/**
 * Platform live-tracking client surface. Wraps <LiveRiderFleetMap/> with the
 * filter chip row + the live stat strip. Stat counts re-derive on every SSE
 * frame / poll (the fleet map calls back with the freshest positions) and on
 * a 5 s clock, so "signal lost" and ETAs age correctly between updates.
 * All counting lives in lib/live-fleet.ts (computeFleetStats).
 *
 * Filters:
 *   - Status: All / Idle / Awaiting pickup / On delivery / Signal lost
 *   - Branch: dropdown narrows to a single branch (server-page passes list)
 *   - Visible layers: 🍽️ branches, 🏠 customers, breadcrumb trails
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Bike, Truck, Activity, Timer, WifiOff } from 'lucide-react';
// Use the SSR-safe loader — Leaflet touches `window` at import time, which
// crashes /admin/live and /platform/live during server render.
import {
  LiveRiderFleetMap,
  type RiderPosition,
  type BranchPin,
  type CustomerPin,
  type StatusFilter,
  type VisibleLayers
} from '@/components/live-rider-fleet-map-loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { computeFleetStats, formatAgo, withWaitingRiders, type WaitingRider } from '@/lib/live-fleet';

interface Props {
  /** Server snapshot (server/live-fleet.ts): real fix times, leg + destination per rider. */
  initial: RiderPosition[];
  branches: BranchPin[];
  customers: CustomerPin[];
  /** Online riders with no GPS fix to plot yet (server/live-fleet.ts). */
  waiting?: WaitingRider[];
  isSuperAdmin?: boolean;
  channel?: string;
  /** Whether to render the branch dropdown. Hidden on the admin page since
   *  tenancy is implicit. */
  showBranchFilter?: boolean;
  /** Optional REST endpoint the fleet map polls (~4s) as a reliable backstop
   *  to the SSE stream — keeps every online rider's pin fresh even if an SSE
   *  frame is dropped. */
  pollUrl?: string;
}

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IDLE', label: 'Idle' },
  { id: 'AWAITING_PICKUP', label: 'Awaiting pickup' },
  { id: 'ON_DELIVERY', label: 'On delivery' },
  { id: 'SIGNAL_LOST', label: 'Signal lost' }
];

export function LivePlatformClient({ initial, branches, customers: initialCustomers, waiting: initialWaiting = [], isSuperAdmin = true, channel = 'platform:riders', showBranchFilter = true, pollUrl }: Props) {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [branchId, setBranchId] = useState<string>('');
  const [layers, setLayers] = useState<VisibleLayers>({ branches: true, customers: false, trails: false });
  const [positions, setPositions] = useState<RiderPosition[]>(initial);
  const [customers, setCustomers] = useState<CustomerPin[]>(initialCustomers);
  const [waiting, setWaiting] = useState<WaitingRider[]>(initialWaiting);
  // Clock for time-based stats ("signal lost", ETA) between data updates.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // Branch filter narrows pins (rider home base or destination) — for the demo
  // we simply scope `branches` shown on the map; rider scoping happens server-side
  // via the SSE channel scope.
  const filteredBranches = useMemo(
    () => (branchId ? branches.filter((b) => b.id === branchId) : branches),
    [branches, branchId]
  );

  const stats = useMemo(
    () => withWaitingRiders(computeFleetStats(positions, now), waiting, now),
    [positions, waiting, now]
  );

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatChip icon={Bike}     label="Online"           value={stats.online}                 tone="success" hint="App heard from in the last 2 min" />
        <StatChip icon={Activity} label="Awaiting pickup"  value={stats.headingToPickup}        tone="warning" hint="Heading to the restaurant, or offer not yet accepted" />
        <StatChip icon={Truck}    label="On delivery"      value={stats.onDelivery}             tone="primary" hint="Food picked up, heading to the customer" />
        <StatChip icon={WifiOff}  label="Signal lost"      value={stats.signalLost}             tone="muted"   hint="No contact from the rider app for over 2 min" />
        <StatChip icon={Timer}    label="Avg ETA"          value={stats.avgEta != null ? `${stats.avgEta} min` : '—'} tone="primary" hint="To the end of each rider's current leg" />
      </div>

      {waiting.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm" role="status">
          <div className="font-medium text-warning">
            {waiting.length === 1 ? '1 rider is' : `${waiting.length} riders are`} online without a GPS location
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {waiting.map((w) => (
              <li key={w.riderId}>
                <span className="font-medium text-foreground">{w.name ?? 'Rider'}</span>
                {' — '}
                {w.gpsEnabled === false
                  ? 'location is turned off on the phone'
                  : 'no location received yet (check the app has location permission)'}
                {' · last heard '}
                {formatAgo(w.seenAt, now)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filter chips row */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter riders by status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatus(t.id)}
              aria-pressed={status === t.id}
              className={
                'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
                (status === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70 text-muted-foreground')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        {showBranchFilter && (
          <>
            <Select value={branchId || 'all'} onValueChange={(v) => setBranchId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="h-5 w-px bg-border mx-1" />
          </>
        )}
        <LayerToggle
          label="🍽️ Branches"
          active={layers.branches}
          onChange={(v) => setLayers((l) => ({ ...l, branches: v }))}
        />
        <LayerToggle
          label="🏠 Customers"
          active={layers.customers}
          onChange={(v) => setLayers((l) => ({ ...l, customers: v }))}
        />
        <LayerToggle
          label="Trails"
          active={layers.trails}
          onChange={(v) => setLayers((l) => ({ ...l, trails: v }))}
        />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-3">
          <LiveRiderFleetMap
            channel={channel}
            initial={initial}
            height="640px"
            branches={filteredBranches}
            customers={customers}
            statusFilter={status}
            visibleLayers={layers}
            isSuperAdmin={isSuperAdmin}
            pollUrl={pollUrl}
            onPositionsChange={setPositions}
            onCustomersChange={setCustomers}
            onWaitingChange={setWaiting}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatChip({ icon: Icon, label, value, tone, hint }: { icon: any; label: string; value: number | string; tone: 'primary' | 'success' | 'warning' | 'muted'; hint?: string }) {
  const cls = {
    primary: 'bg-primary/10 text-primary border-primary/30',
    success: 'bg-success/10 text-success border-success/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
    muted: 'bg-muted text-muted-foreground border-border'
  }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${cls}`} title={hint}>
      <Icon className="size-5 shrink-0" />
      <div>
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div className="font-bold text-xl leading-tight">{value}</div>
      </div>
    </div>
  );
}

function LayerToggle({ label, active, onChange }: { label: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={
        'rounded-full px-3 py-1 text-xs font-medium border transition-colors ' +
        (active
          ? 'bg-primary/10 text-primary border-primary/40'
          : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/70')
      }
    >
      {label}
    </button>
  );
}
