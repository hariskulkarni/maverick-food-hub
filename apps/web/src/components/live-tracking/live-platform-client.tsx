'use client';
/**
 * Platform live-tracking client surface. Wraps <LiveRiderFleetMap/> with the
 * filter chip row + the live stat strip. Stat counts re-derive on every SSE
 * tick because the fleet map calls back into us with the freshest positions.
 *
 * Filters:
 *   - Status: All / Idle / On-delivery / Awaiting-pickup
 *   - Branch: dropdown narrows to a single branch (server-page passes list)
 *   - Visible layers: 🍽️ branches, 🏠 customers, breadcrumb trails
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Bike, Truck, Activity, Package, Timer } from 'lucide-react';
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
import { computeEta } from '@/server/eta';

interface Destination { riderId: string; lat: number; lng: number }

interface Props {
  initial: RiderPosition[];
  branches: BranchPin[];
  customers: CustomerPin[];
  /** rider → drop point (used to derive avg ETA live) */
  destinations: Destination[];
  isSuperAdmin?: boolean;
  channel?: string;
  /** Whether to render the branch dropdown. Hidden on the admin page since
   *  tenancy is implicit. */
  showBranchFilter?: boolean;
}

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IDLE', label: 'Idle' },
  { id: 'ON_DELIVERY', label: 'On delivery' },
  { id: 'AWAITING_PICKUP', label: 'Awaiting pickup' }
];

export function LivePlatformClient({ initial, branches, customers, destinations, isSuperAdmin = true, channel = 'platform:riders', showBranchFilter = true }: Props) {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [branchId, setBranchId] = useState<string>('');
  const [layers, setLayers] = useState<VisibleLayers>({ branches: true, customers: false, trails: false });
  const [positions, setPositions] = useState<RiderPosition[]>(initial);

  // Branch filter narrows pins (rider home base or destination) — for the demo
  // we simply scope `branches` shown on the map; rider scoping happens server-side
  // via the SSE channel scope.
  const filteredBranches = useMemo(
    () => (branchId ? branches.filter((b) => b.id === branchId) : branches),
    [branches, branchId]
  );

  const stats = useMemo(() => {
    let online = 0, onDelivery = 0, awaitingPickup = 0;
    for (const p of positions) {
      online++;
      if (p.status === 'PICKED_UP' || p.status === 'ACCEPTED') onDelivery++;
      else if (p.status === 'PENDING') awaitingPickup++;
    }
    const destMap = new Map(destinations.map((d) => [d.riderId, d]));
    const etas: number[] = [];
    for (const p of positions) {
      const d = destMap.get(p.riderId);
      if (!d) continue;
      const m = computeEta({ lat: p.lat, lng: p.lng }, { lat: d.lat, lng: d.lng });
      if (m != null) etas.push(m);
    }
    const avgEta = etas.length ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length) : null;
    return { online, onDelivery, awaitingPickup, avgEta };
  }, [positions, destinations]);

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid gap-3 md:grid-cols-4">
        <StatChip icon={Bike}     label="Online"           value={stats.online}                 tone="success" />
        <StatChip icon={Truck}    label="On delivery"      value={stats.onDelivery}             tone="primary" />
        <StatChip icon={Activity} label="Awaiting pickup"  value={stats.awaitingPickup}         tone="warning" />
        <StatChip icon={Timer}    label="Avg ETA"          value={stats.avgEta != null ? `${stats.avgEta} min` : '—'} tone="primary" />
      </div>

      {/* Filter chips row */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
        <div className="flex gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatus(t.id)}
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
            onPositionsChange={setPositions}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatChip({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone: 'primary' | 'success' | 'warning' }) {
  const cls = { primary: 'bg-primary/10 text-primary border-primary/30', success: 'bg-success/10 text-success border-success/30', warning: 'bg-warning/10 text-warning border-warning/30' }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${cls}`}>
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
