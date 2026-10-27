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
 * Foreground only — streaming stops when the app is backgrounded. During an
 * accepted delivery with background permission, lib/background-location.ts
 * takes over posting (it keeps running in the background); this hook then only
 * feeds the in-app map and sends nothing, so points aren't duplicated.
 */
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { api } from './api';
import { isBackgroundTrackingActive } from './background-location';

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
          if (!isBackgroundTrackingActive()) {
            // `accuracy` (m) + `mocked` (OS fake-GPS flag) feed location-integrity.
            const accuracy = first.coords.accuracy ?? undefined;
            const mocked = (first as { mocked?: boolean }).mocked;
            api.sendLocation(lat, lng, orderId ?? undefined, undefined, first.timestamp, accuracy, mocked).catch(() => {});
          }
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
          // On a delivery: a fix every ~8 s / 10 m so the customer tracker is
          // genuinely live. While merely online: every ~15 s with NO distance
          // filter — on Android a distance filter suppresses updates entirely
          // while the rider stands still, so a rider waiting outside a
          // restaurant never sent a fresh fix and the fleet map aged them out.
          timeInterval: onDelivery ? 8000 : 15000,
          distanceInterval: onDelivery ? 10 : 0,
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
          // Skipped while the background task is streaming the same fixes.
          if (!isBackgroundTrackingActive()) {
            const accuracy = loc.coords.accuracy ?? undefined;
            const mocked = (loc as { mocked?: boolean }).mocked;
            api.sendLocation(lat, lng, orderId ?? undefined, speedKph, loc.timestamp, accuracy, mocked).catch(() => {});
          }
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
