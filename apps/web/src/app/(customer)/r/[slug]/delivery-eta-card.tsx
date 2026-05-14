'use client';
/**
 * Customer-side delivery-time card.
 *
 * Mounted on `/r/[slug]`. Asks the browser for the customer's current
 * geolocation, posts to `/api/customer/delivery-eta`, and renders the
 * distance + ETA + delivery fee preview.
 *
 * UX rules:
 *   - Don't auto-prompt for location. Show a button. The browser permission
 *     dialog is jarring when surprise-fired on first load.
 *   - Cache the granted location in localStorage (with a 30-min TTL) so a
 *     customer navigating across restaurants doesn't re-prompt every time.
 *   - Show distinct states: idle / asking / loading / granted / outside-radius
 *     / denied. Each gets its own affordance.
 *   - When permission is denied or geolocation isn't supported, render the
 *     city-level fallback ("Delivers across Koramangala — ~35 min typical").
 */
import { useEffect, useState } from 'react';
import { MapPin, Bike, Clock, AlertTriangle, CheckCircle2, Locate } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardContent className="p-4 sm:p-5">
        {state.kind === 'idle' && (
          <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Locate className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">See your delivery time</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Share your location to see how long {branchName} will take to deliver to you.
              </p>
            </div>
            <Button size="sm" onClick={requestLocation} className="shrink-0">
              <MapPin className="size-3.5" /> Use my location
            </Button>
          </div>
        )}

        {state.kind === 'asking' && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="relative inline-flex">
              <span className="size-2 rounded-full bg-primary" />
              <span className="absolute inset-0 size-2 rounded-full bg-primary pulse-soft" />
            </span>
            Waiting for your browser's location permission…
          </div>
        )}

        {state.kind === 'loading' && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="relative inline-flex">
              <span className="size-2 rounded-full bg-primary" />
              <span className="absolute inset-0 size-2 rounded-full bg-primary pulse-soft" />
            </span>
            Calculating delivery time…
          </div>
        )}

        {state.kind === 'ok' && (
          <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
            <div className="grid size-11 place-items-center rounded-xl bg-success/10 text-success shrink-0">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-base">{state.data.etaRange.min}–{state.data.etaRange.max} min</span>
                <Badge variant="success" className="text-[10px]">DELIVERS TO YOU</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1"><Bike className="size-3" /> {state.data.distanceKm} km away</span>
                <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~{state.data.breakdown.prepMin} min kitchen + ~{state.data.breakdown.travelMin} min ride</span>
                <span className="inline-flex items-center gap-1">₹{state.data.deliveryFee} delivery</span>
              </div>
            </div>
            <button type="button" onClick={requestLocation} className="text-xs text-primary hover:underline shrink-0">
              Refresh
            </button>
          </div>
        )}

        {state.kind === 'outside' && (
          <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
            <div className="grid size-11 place-items-center rounded-xl bg-warning/10 text-warning shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">Outside this branch's delivery zone</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                You're {state.data.distanceKm} km away — this branch only delivers within {state.data.serviceRadiusKm} km.
                You can still browse the menu and place a pickup order.
              </p>
            </div>
            <button type="button" onClick={requestLocation} className="text-xs text-primary hover:underline shrink-0">
              Refresh
            </button>
          </div>
        )}

        {state.kind === 'denied' && (
          <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
            <div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground shrink-0">
              <MapPin className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">Delivery typically ~35 min{branchCity ? ` across ${branchCity}` : ''}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{state.reason}. You can still continue and enter your address at checkout.</p>
            </div>
            <Button size="sm" variant="outline" onClick={requestLocation} className="shrink-0">
              Try again
            </Button>
          </div>
        )}

        {state.kind === 'no-geo' && (
          <div className="text-xs text-muted-foreground">
            This branch hasn't published its location yet — exact delivery time will show at checkout.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
