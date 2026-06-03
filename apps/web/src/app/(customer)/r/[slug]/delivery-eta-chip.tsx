'use client';

/**
 * Sticky-bar delivery ETA chip. Replaces the old hardcoded "~35 min".
 * Shows a sensible default range, and upgrades to an EXACT per-user estimate
 * (prep + distance + buffer) by calling POST /api/customer/delivery-eta with
 * the viewer's coordinates. Non-intrusive: auto-locates only if the browser
 * already granted geolocation; otherwise the chip is tappable to opt in.
 */
import { useEffect, useState, useCallback } from 'react';
import { Clock } from 'lucide-react';

export function DeliveryEtaChip({
  branchId,
  hasGeo,
  defaultLabel = '30–40 min',
}: {
  branchId: string;
  hasGeo: boolean;
  defaultLabel?: string;
}) {
  const [label, setLabel] = useState(`~${defaultLabel} delivery`);
  const [exact, setExact] = useState(false);

  const fetchEta = useCallback(async (lat: number, lng: number) => {
    try {
      const res = await fetch('/api/customer/delivery-eta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branchId, lat, lng }),
      });
      if (!res.ok) return;
      const d: any = await res.json();
      const mins =
        d.etaMin ?? d.deliveryMinutes ?? d.etaMinutes ?? d.minutes ?? d?.eta?.minutes;
      const within = d.withinRadius ?? d.inRange ?? d.within_radius;
      if (typeof mins === 'number' && mins > 0) {
        setLabel(`~${Math.round(mins)} min delivery${within === false ? ' · out of range' : ''}`);
        setExact(true);
      }
    } catch {
      /* keep default */
    }
  }, [branchId]);

  useEffect(() => {
    if (!hasGeo || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            (pos) => fetchEta(pos.coords.latitude, pos.coords.longitude),
            () => {},
            { maximumAge: 5 * 60_000, timeout: 8000 },
          );
        }
      })
      .catch(() => {});
  }, [hasGeo, fetchEta]);

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchEta(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [fetchEta]);

  return (
    <button
      type="button"
      onClick={locate}
      title={exact ? 'Estimated for your location' : 'Tap to use your location for an exact time'}
      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      <Clock className="size-4" /> {label}
    </button>
  );
}
