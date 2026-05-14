/**
 * Foreground GPS streaming for an active delivery.
 *
 * While `enabled`, watches the device location and POSTs each fix to
 * /api/rider/location (tagged with the orderId). The backend fans it out over
 * SSE to the customer + admin trackers and throttles its own DB writes, so the
 * app can stream freely. Returns the latest fix for the in-app map.
 *
 * Foreground only — streaming stops when the app is backgrounded. Background
 * tracking needs expo-task-manager + a background-location permission and is a
 * separate, larger piece of work.
 */
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { api } from './api';

export interface LatLng {
  lat: number;
  lng: number;
}

export function useRiderLocation(opts: { orderId: string | null; enabled: boolean }) {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!opts.enabled) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000, // at most every 5s …
          distanceInterval: 20, // … or every 20 metres, whichever comes first
        },
        (loc) => {
          if (cancelled) return;
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;
          // coords.speed is m/s and can be null or -1 when unknown.
          const rawSpeed = loc.coords.speed;
          const speedKph =
            rawSpeed != null && rawSpeed >= 0 ? rawSpeed * 3.6 : undefined;
          setPosition({ lat, lng });
          // Fire-and-forget — a dropped ping just means one missed update.
          api.sendLocation(lat, lng, opts.orderId ?? undefined, speedKph).catch(() => {});
        }
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [opts.enabled, opts.orderId]);

  return { position, permissionDenied };
}
