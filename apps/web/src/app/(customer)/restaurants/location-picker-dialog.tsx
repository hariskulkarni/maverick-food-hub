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

import { useState } from 'react';
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
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import type { PickedAddress } from '@/components/address-picker';

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
      toast.error('Geolocation is not available in this browser.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
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
      () => {
        setGeoLoading(false);
        toast.error('Could not get your location. Allow location access or pick on the map.');
      },
      { enableHighAccuracy: true, timeout: 10_000 }
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

  async function useSaved(a: SavedAddressOption) {
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
                    onClick={() => useSaved(a)}
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
