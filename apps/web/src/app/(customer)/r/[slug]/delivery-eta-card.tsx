'use client';
/**
 * Customer-side delivery-time bar.
 *
 * Mounted on `/r/[slug]`. Asks the browser for the customer's current
 * geolocation, posts to `/api/customer/delivery-eta`, and renders the
 * distance + ETA + delivery fee preview.
 *
 * Compact by design: this sits above the menu, so it's a single slim row in
 * every state — the customer is here for food first, delivery time second.
 *
 * UX rules:
 *   - Don't auto-prompt for location. Show a button. The browser permission
 *     dialog is jarring when surprise-fired on first load.
 *   - Cache the granted location in localStorage (with a 30-min TTL) so a
 *     customer navigating across restaurants doesn't re-prompt every time.
 *   - Show distinct states: idle / asking / loading / granted / outside-radius
 *     / denied. Each gets its own affordance.
 *   - When permission is denied or geolocation isn't supported, render the
 *     city-level fallback ("~35 min typical").
 */
import { useEffect, useState } from 'react';
import { MapPin, AlertTriangle, CheckCircle2, Locate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  branchId: string;
  branchName: string;
  branchCity?: string | null;
}

interface EtaPayload {
  distanceKm: number;
  withinRadius: boolean;
  serviceRadiusKm: number;
  etaMin: number;
  etaRange: { min: number; max: number };
  deliveryFee: number;
  breakdown: { prepMin: number; pickupMin: number; travelMin: number };
}

type State =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: EtaPayload }
  | { kind: 'outside'; data: EtaPayload }
  | { kind: 'denied'; reason: string }
  | { kind: 'no-geo' };

// 30 min cache so a customer bouncing between menu/cart/menu isn't re-prompted.
const CACHE_KEY = 'mfh.customer.geo';
const CACHE_TTL_MIN = 30;

function readCachedGeo(): { lat: number; lng: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { lat, lng, ts } = JSON.parse(raw);
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof ts !== 'number') return null;
    if (Date.now() - ts > CACHE_TTL_MIN * 60_000) return null;
    return { lat, lng };
  } catch { return null; }
}

function writeCachedGeo(lat: number, lng: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
  } catch { /* private mode etc. — ignore */ }
}

/** Slim pulsing dot used by the asking/loading states. */
function PulseDot() {
  return (
    <span className="relative inline-flex shrink-0">
      <span className="size-2 rounded-full bg-primary" />
      <span className="absolute inset-0 size-2 rounded-full bg-primary pulse-soft" />
    </span>
  );
}

export function DeliveryEtaCard({ branchId, branchName, branchCity }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function fetchEta(lat: number, lng: number) {
    setState({ kind: 'loading' });
    try {
      const r = await fetch('/api/customer/delivery-eta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, lat, lng }),
      });
      const data = await r.json();
      if (!r.ok) {
        setState({ kind: 'denied', reason: data.error ?? 'Failed to compute delivery time' });
        return;
      }
      if (data.error === 'branch_no_geo') {
        setState({ kind: 'no-geo' });
        return;
      }
      setState({ kind: data.withinRadius ? 'ok' : 'outside', data });
    } catch (e) {
      setState({ kind: 'denied', reason: 'Network error' });
    }
  }

  // Use cached location if fresh — silent path with no prompt.
  useEffect(() => {
    const cached = readCachedGeo();
    if (cached) fetchEta(cached.lat, cached.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function requestLocation() {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setState({ kind: 'denied', reason: 'Your browser does not support location' });
      return;
    }
    setState({ kind: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        writeCachedGeo(latitude, longitude);
        fetchEta(latitude, longitude);
      },
      (err) => {
        const reason =
          err.code === err.PERMISSION_DENIED
            ? 'Location access denied — you can still order'
            : err.code === err.POSITION_UNAVAILABLE
            ? 'We couldn\'t read your location'
            : err.code === err.TIMEOUT
            ? 'Location request timed out'
            : 'Could not get your location';
        setState({ kind: 'denied', reason });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  }

  // One slim bar, ~44px tall, in every state. Subtle tint so it reads as a
  // helper strip — not a hero card competing with the food below it.
  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.03] px-3 py-2 min-h-11 flex items-center">
      {state.kind === 'idle' && (
        <div className="flex w-full items-center gap-2.5">
          <Locate className="size-4 shrink-0 text-primary" />
          <span className="flex-1 min-w-0 text-sm font-medium">See your delivery time</span>
          <Button size="sm" onClick={requestLocation} className="h-8 shrink-0 px-3 text-xs">
            <MapPin className="size-3.5" /> Use my location
          </Button>
        </div>
      )}

      {state.kind === 'asking' && (
        <div className="flex w-full items-center gap-2.5 text-sm text-muted-foreground">
          <PulseDot /> Getting your location…
        </div>
      )}

      {state.kind === 'loading' && (
        <div className="flex w-full items-center gap-2.5 text-sm text-muted-foreground">
          <PulseDot /> Calculating delivery time…
        </div>
      )}

      {state.kind === 'ok' && (
        <div className="flex w-full items-center gap-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold leading-none">{state.data.etaRange.min}–{state.data.etaRange.max} min</span>
              <Badge variant="success" className="text-[9px] leading-none">DELIVERS TO YOU</Badge>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {state.data.distanceKm} km away · ₹{state.data.deliveryFee} delivery
            </div>
          </div>
          <button type="button" onClick={requestLocation} className="shrink-0 text-xs text-primary hover:underline">
            Refresh
          </button>
        </div>
      )}

      {state.kind === 'outside' && (
        <div className="flex w-full items-center gap-2.5">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">Outside delivery zone</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {state.data.distanceKm} km away · delivers within {state.data.serviceRadiusKm} km · pickup ok
            </div>
          </div>
          <button type="button" onClick={requestLocation} className="shrink-0 text-xs text-primary hover:underline">
            Refresh
          </button>
        </div>
      )}

      {state.kind === 'denied' && (
        <div className="flex w-full items-center gap-2.5">
          <MapPin className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight">~35 min{branchCity ? ` · ${branchCity}` : ''}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{state.reason}</div>
          </div>
          <Button size="sm" variant="outline" onClick={requestLocation} className="h-8 shrink-0 px-3 text-xs">
            Try again
          </Button>
        </div>
      )}

      {state.kind === 'no-geo' && (
        <div className="flex w-full items-center gap-2.5 text-[11px] text-muted-foreground">
          <MapPin className="size-4 shrink-0" /> Exact delivery time will show at checkout.
        </div>
      )}
    </div>
  );
}
