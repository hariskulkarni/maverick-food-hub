/**
 * Foreground GPS streaming for an online rider.
 *
 * While `enabled`, watches the device location and POSTs each fix to
 * /api/rider/location. The backend fans it out over SSE to the customer +
 * admin + super-admin trackers and throttles its own DB writes, so the app
 * can stream freely. Returns the latest fix for the in-app map.
 *
 * Streaming runs the WHOLE time the rider is online — not only during an
 * active delivery. Pass an `orderId` when a delivery is in flight so the ping
 * is tagged for the customer/branch trackers; leave it null while idle and the
 * fix still reaches the super-admin fleet map. When `orderId` is set we also
 * upgrade to `BestForNavigation` accuracy for tighter turn-by-turn tracking.
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

  const { orderId, enabled } = opts;
  // On an active delivery we want the tightest possible fix; while merely
  // online, High is accurate enough and far easier on the battery.
  const onDelivery = !!orderId;

  useEffect(() => {
    if (!enabled) return;

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

      // Push an immediate fix so the fleet map shows the rider the moment they
      // go online, instead of waiting for the first watch callback.
      try {
        const first = await Location.getCurrentPositionAsync({
          accuracy: onDelivery
            ? Location.Accuracy.BestForNavigation
            : Location.Accuracy.High,
        });
        if (!cancelled) {
          const lat = first.coords.latitude;
          const lng = first.coords.longitude;
          setPosition({ lat, lng });
          api.sendLocation(lat, lng, orderId ?? undefined).catch(() => {});
        }
      } catch {
        // Non-fatal — the watch below will deliver the first fix shortly.
      }
      if (cancelled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: onDelivery
            ? Location.Accuracy.BestForNavigation
            : Location.Accuracy.High,
          // Tight cadence so the super-admin map (and customer tracker) stay
          // genuinely live: a fix at least every ~8s, or whenever the rider
          // moves ~15m — whichever comes first.
          timeInterval: 8000,
          distanceInterval: 15,
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
          api.sendLocation(lat, lng, orderId ?? undefined, speedKph).catch(() => {});
        }
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, orderId, onDelivery]);

  return { position, permissionDenied };
}
