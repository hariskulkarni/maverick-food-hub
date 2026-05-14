'use client';
/**
 * RiderPanel — 360px overlay that drops in over the live fleet map when an
 * operator clicks a rider pin. Fetches the rider's active order + last 50
 * GPS pings, computes a live ETA from current position → destination, and
 * (for super-admins) exposes "call" and "reassign" buttons.
 *
 * The panel is intentionally *not* a separate route — it shares the map
 * canvas so the operator can keep watching pins move while drilling in.
 */

import { useEffect, useState } from 'react';
import { Bike, Phone, X, MapPin, Package, ShieldAlert, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { computeEta, formatEta } from '@/server/eta';
import { ReassignModal } from './reassign-modal';

export interface RiderPanelRider {
  riderId: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  rider: RiderPanelRider;
  /** When true, "Reassign" + ability to fetch via the platform endpoints is allowed. */
  isSuperAdmin: boolean;
  /** Whether trails are currently being shown on the map. */
  trailVisible: boolean;
  onToggleTrail: (next: boolean) => void;
  onClose: () => void;
  /** Called once `recent-pings` resolves so the parent map can render the polyline. */
  onPings?: (pings: { lat: number; lng: number; at: string }[]) => void;
}

interface ActiveOrder {
  id: string;
  status: string;
  orderId: string;
  order: {
    id: string;
    code: string;
    status: string;
    customer: { id: string; name: string | null; phone: string | null };
    address: { id: string; line1: string; line2: string | null; city: string; latitude: number | null; longitude: number | null } | null;
    branch: { id: string; name: string; latitude: number | null; longitude: number | null; line1: string; city: string; restaurant: { id: string; name: string } };
  };
  rider: {
    id: string;
    vehicleType: string;
    vehicleNumber: string | null;
    user: { name: string | null; phone: string | null };
  };
}

export function RiderPanel({ rider, isSuperAdmin, trailVisible, onToggleTrail, onClose, onPings }: Props) {
  const [active, setActive] = useState<ActiveOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showReassign, setShowReassign] = useState(false);

  // Fetch active assignment whenever rider changes
  useEffect(() => {
    let cancelled = false;
    setActive(undefined);
    setError(null);
    fetch(`/api/platform/riders/${rider.riderId}/active-order`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data) => { if (!cancelled) setActive(data); })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [rider.riderId]);

  // Fetch trail pings
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/platform/riders/${rider.riderId}/recent-pings?limit=50`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (cancelled) return;
        const pings = rows.map((p) => ({ lat: p.lat, lng: p.lng, at: p.createdAt }));
        onPings?.(pings);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // onPings intentionally not a dep — parent passes a fresh fn each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider.riderId]);

  // Pick the right destination: if rider is en route to pickup, target is the
  // branch; if they've picked up, target is the customer.
  const dest = active?.status === 'PICKED_UP'
    ? active.order.address
      ? { lat: active.order.address.latitude ?? 0, lng: active.order.address.longitude ?? 0 }
      : null
    : active
      ? { lat: active.order.branch.latitude ?? 0, lng: active.order.branch.longitude ?? 0 }
      : null;

  const etaMin = active && dest && dest.lat && dest.lng
    ? computeEta({ lat: rider.lat, lng: rider.lng }, dest)
    : null;

  const phone = active?.rider.user.phone;
  const initials = (rider.name ?? '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'R';

  return (
    <div className="absolute right-0 top-0 bottom-0 z-[500] w-[360px] max-w-full bg-card border-l shadow-2xl flex flex-col animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid size-11 place-items-center rounded-full bg-success/15 text-success font-semibold shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate flex items-center gap-2">
              {rider.name}
              <span className="inline-block size-2 rounded-full bg-success" title="Online" />
            </div>
            {active && (
              <div className="text-xs text-muted-foreground truncate">
                {active.rider.vehicleType}{active.rider.vehicleNumber ? ` · ${active.rider.vehicleNumber}` : ''}
              </div>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>

      {/* Trail toggle */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <label htmlFor="trail-toggle" className="text-xs font-medium flex items-center gap-2">
          <ListChecks className="size-3.5" /> Show breadcrumb trail
        </label>
        <Switch id="trail-toggle" checked={trailVisible} onCheckedChange={onToggleTrail} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {active === undefined && <div className="text-xs text-muted-foreground">Loading active order…</div>}
        {error && <div className="text-xs text-destructive">Couldn't load active order: {error}</div>}

        {active === null && (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            <Bike className="size-5 mx-auto mb-2 opacity-60" />
            This rider is idle. No active assignment.
          </div>
        )}

        {active && (
          <>
            {/* Order summary */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs text-muted-foreground">{active.order.code}</div>
                <Badge variant="outline" className="text-[10px]">{active.status.replace('_', ' ')}</Badge>
              </div>
              <div className="font-medium flex items-center gap-1.5">
                <Package className="size-3.5 text-muted-foreground" />
                {active.order.branch.restaurant.name}
              </div>
              <div className="text-xs text-muted-foreground">
                Pickup · {active.order.branch.name}, {active.order.branch.city}
              </div>
              {active.order.address && (
                <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <MapPin className="size-3.5 mt-0.5 shrink-0" />
                  <span>Drop · {active.order.address.line1}{active.order.address.line2 ? `, ${active.order.address.line2}` : ''}, {active.order.address.city}</span>
                </div>
              )}
            </div>

            {/* ETA */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-primary font-semibold">Live ETA</div>
                <div className="text-2xl font-bold leading-none mt-0.5">{formatEta(etaMin)}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground max-w-[140px]">
                {active.status === 'PICKED_UP' ? 'to customer' : 'to restaurant'} · 25 km/h
              </div>
            </div>

            {/* Customer */}
            <div className="rounded-lg border p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Customer</div>
              <div className="font-medium text-sm">{active.order.customer.name ?? 'Customer'}</div>
              {active.order.customer.phone && (
                <a href={`tel:${active.order.customer.phone}`} className="text-xs text-primary inline-flex items-center gap-1.5 hover:underline">
                  <Phone className="size-3" /> {active.order.customer.phone}
                </a>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t p-3 space-y-2">
        {phone && (
          <a href={`tel:${phone}`} className="block">
            <Button variant="outline" className="w-full justify-center gap-2">
              <Phone className="size-3.5" /> Call rider {phone}
            </Button>
          </a>
        )}
        {isSuperAdmin && active && (
          <Button
            variant="default"
            className="w-full justify-center gap-2"
            onClick={() => setShowReassign(true)}
          >
            <ShieldAlert className="size-3.5" /> Reassign order
          </Button>
        )}
      </div>

      {showReassign && active && (
        <ReassignModal
          orderId={active.orderId}
          currentRiderId={rider.riderId}
          onClose={(reassigned) => {
            setShowReassign(false);
            if (reassigned) onClose();
          }}
        />
      )}
    </div>
  );
}
