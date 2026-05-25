'use client';
/**
 * Shared location-picker dialog used by both the gate (no location yet) and the
 * "deliver to" header (change location). It offers three ways to set the
 * delivery location, all of which end by POSTing { lat, lng, label } to
 * /api/customer/location and refreshing:
 *
 *   1. Use my current location → browser geolocation, reverse-geocoded for a label.
 *   2. Pick on map            → the shared Leaflet AddressPicker.
 *   3. Saved addresses        → quick-pick chips for logged-in users.
 *
 * The cookie is the single source of truth; we never touch localStorage.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Crosshair, Loader2, MapPin, AlertTriangle, Settings } from 'lucide-react';
import type { PickedAddress } from '@/components/address-picker';

/**
 * The browser's permission state for geolocation, as reported by the
 * Permissions API. We keep an extra `'unsupported'` for the (rare) browsers
 * with no `navigator.permissions` and `'unknown'` for "not checked yet".
 *
 * Why this matters: on many Android browsers, once a user taps "Block" the
 * permission is persisted as `denied` and `getCurrentPosition` will *silently*
 * fail forever — it never re-prompts. We can't programmatically re-open the
 * OS/browser permission prompt (there's no API for that, by design). So the
 * only correct UX is: detect `denied`, stop pretending the button will work,
 * and surface (a) clear instructions to re-enable + (b) the always-available
 * manual fallbacks (pick-on-map / saved addresses) so a delivery location can
 * still be captured. That's the "comprehensive" fix.
 */
type GeoPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

const AddressPicker = dynamic(
  () => import('@/components/address-picker').then((m) => m.AddressPicker),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-[320px] w-full place-items-center rounded-xl border bg-muted/40 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
);

/** A saved address surfaced as a quick-pick option (logged-in users only). */
export interface SavedAddressOption {
  id: string;
  label: string;
  line1: string;
  city: string;
  latitude: number;
  longitude: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedAddresses: SavedAddressOption[];
}

/** POST the chosen location to the cookie API, then refresh to re-run discovery. */
async function commitLocation(lat: number, lng: number, label: string) {
  const res = await fetch('/api/customer/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, label })
  });
  return res.ok;
}

export function LocationPickerDialog({ open, onOpenChange, savedAddresses }: Props) {
  const router = useRouter();
  const [geoLoading, setGeoLoading] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [busySavedId, setBusySavedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedAddress | null>(null);
  const [geoPerm, setGeoPerm] = useState<GeoPermission>('unknown');

  // Probe the *current* permission state whenever the dialog opens, and keep it
  // live via the Permissions API `change` event. This lets us render the right
  // affordance immediately (e.g. a "blocked" banner) without first making the
  // user tap a button that we already know will fail. We never auto-trigger the
  // prompt here — that must stay a user gesture.
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoPerm('unsupported');
      return;
    }
    // Permissions API isn't universal (older Safari especially). When it's
    // absent we leave the state at 'unknown' and let the button flow drive it.
    if (!('permissions' in navigator) || !navigator.permissions?.query) {
      setGeoPerm('unknown');
      return;
    }

    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status) setGeoPerm(status.state as GeoPermission);
    };

    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setGeoPerm(s.state as GeoPermission);
        s.addEventListener('change', onChange);
      })
      .catch(() => {
        // Some browsers throw for the geolocation descriptor — degrade to the
        // button-driven flow rather than blocking the user.
        if (!cancelled) setGeoPerm('unknown');
      });

    return () => {
      cancelled = true;
      if (status) status.removeEventListener('change', onChange);
    };
  }, [open]);

  async function finish(lat: number, lng: number, label: string) {
    const ok = await commitLocation(lat, lng, label);
    if (!ok) {
      toast.error('Could not set your location. Please try again.');
      return false;
    }
    onOpenChange(false);
    router.refresh();
    return true;
  }

  function useCurrentLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoPerm('unsupported');
      toast.error('Geolocation is not available in this browser. Pick on the map instead.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setGeoPerm('granted');
          const { latitude, longitude } = pos.coords;
          // Reverse-geocode for a human label (best-effort; falls back if it fails).
          let label = 'Current location';
          try {
            const res = await fetch('/api/customer/addresses/reverse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat: latitude, lng: longitude })
            });
            if (res.ok) {
              const a = (await res.json()) as { line1?: string; city?: string };
              label = [a.line1, a.city].filter(Boolean).join(', ') || label;
            }
          } catch {
            /* keep fallback label */
          }
          await finish(latitude, longitude, label);
        } finally {
          setGeoLoading(false);
        }
      },
      (err) => {
        setGeoLoading(false);
        // Distinguish the three failure modes. PERMISSION_DENIED (1) is the
        // sticky Android case: the browser has stored a block and will NOT
        // re-prompt — so we flip into the persistent "blocked" banner and stop
        // implying the button will work. POSITION_UNAVAILABLE (2) and TIMEOUT
        // (3) are transient, so we keep the button live and invite a retry.
        if (err.code === err.PERMISSION_DENIED) {
          setGeoPerm('denied');
          toast.error('Location access is blocked. Re-enable it below, or pick on the map.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          toast.error('Your location is unavailable right now. Try again or pick on the map.');
        } else if (err.code === err.TIMEOUT) {
          toast.error('Locating you took too long. Try again or pick on the map.');
        } else {
          toast.error('Could not get your location. Allow access or pick on the map.');
        }
      },
      // maximumAge lets a recent fix satisfy the request instantly (helps the
      // flaky-GPS Android case); timeout keeps us from hanging on a cold start.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  async function useMapSelection() {
    if (!picked || picked.latitude == null || picked.longitude == null) {
      toast.error('Drop a pin on the map or search for a place first.');
      return;
    }
    setSavingMap(true);
    try {
      const label = [picked.line1, picked.city].filter(Boolean).join(', ') || 'Selected location';
      await finish(picked.latitude, picked.longitude, label);
    } finally {
      setSavingMap(false);
    }
  }

  // Not `useSaved` — a `use`-prefixed name trips react-hooks/rules-of-hooks
  // even though this is a plain event handler, not a Hook.
  async function applySavedAddress(a: SavedAddressOption) {
    setBusySavedId(a.id);
    try {
      const label = `${a.label} · ${[a.line1, a.city].filter(Boolean).join(', ')}`;
      await finish(a.latitude, a.longitude, label);
    } finally {
      setBusySavedId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set your delivery location</DialogTitle>
          <DialogDescription>
            We&apos;ll only show restaurants that can deliver to this spot.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* 1. Current location */}
          {geoPerm === 'denied' || geoPerm === 'unsupported' ? (
            // Blocked / unsupported: the OS-level prompt can't be re-triggered
            // programmatically, so we don't dangle a dead button. We explain how
            // to re-enable and point at the map/saved fallbacks just below.
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {geoPerm === 'unsupported'
                      ? 'Location isn’t available in this browser'
                      : 'Location access is turned off'}
                  </p>
                  <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
                    {geoPerm === 'unsupported'
                      ? 'No problem — drop a pin on the map below to set your delivery spot.'
                      : 'To use your current location, tap the address-bar lock / site-settings icon and set Location to “Allow”, then try again. Or just pick on the map below — that works right now.'}
                  </p>
                  {geoPerm === 'denied' && (
                    <button
                      type="button"
                      onClick={useCurrentLocation}
                      disabled={geoLoading}
                      className="tap-press mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white/70 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-white disabled:opacity-60 dark:border-amber-400/40 dark:bg-amber-900/40 dark:text-amber-100"
                    >
                      {geoLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Settings className="size-3.5" />
                      )}
                      I’ve enabled it — try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={useCurrentLocation}
              disabled={geoLoading}
              className="tap-press w-full justify-start"
            >
              {geoLoading ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
              <span className="ml-1">Use my current location</span>
            </Button>
          )}

          {/* 3. Saved addresses (logged-in only) */}
          {savedAddresses.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your saved addresses
              </div>
              <div className="grid gap-2">
                {savedAddresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => applySavedAddress(a)}
                    disabled={busySavedId !== null}
                    className="tap-press flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:border-primary/40 disabled:opacity-60"
                  >
                    {busySavedId === a.id ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{a.label}</span>
                      <span className="block truncate text-muted-foreground">
                        {[a.line1, a.city].filter(Boolean).join(', ')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. Pick on map */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Or pick on the map
            </div>
            <AddressPicker onChange={setPicked} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={savingMap || geoLoading}>
            Cancel
          </Button>
          <Button
            onClick={useMapSelection}
            disabled={savingMap || geoLoading || !picked || picked.latitude == null}
            className="tap-press"
          >
            {savingMap ? <Loader2 className="size-4 animate-spin" /> : 'Use this location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
