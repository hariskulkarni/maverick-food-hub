/**
 * React-side glue for background delivery tracking (lib/background-location.ts).
 *
 *  - `pickTrackedOrderId` chooses which active assignment the GPS points are
 *    tagged with (a picked-up order first, else an accepted one).
 *  - `syncDeliveryTracking` starts / retargets / stops tracking from a fresh
 *    assignment list (home screen load, after a delivery finishes).
 *  - `useDeliveryTracking` drives the delivery screen: starts tracking once the
 *    assignment is accepted, shows the prominent disclosure before asking for
 *    "Allow all the time", and reports the state for the in-app banner.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, type Assignment } from './api';
import { orderHold } from './order-hold';
import { setTrackingTarget, startDeliveryTracking } from './background-location';

/** Orders whose disclosure was already shown this session (don't nag on every render). */
const disclosureShown = new Set<string>();

function isTrackable(a: Pick<Assignment, 'status' | 'order'>): boolean {
  return (a.status === 'ACCEPTED' || a.status === 'PICKED_UP') && orderHold(a) !== 'closed';
}

export function pickTrackedOrderId(list: Pick<Assignment, 'status' | 'order' | 'orderId'>[]): string | null {
  const live = list.filter(isTrackable);
  return (live.find((a) => a.status === 'PICKED_UP') ?? live[0])?.orderId ?? null;
}

/**
 * Bring background tracking in line with the rider's online flag and current
 * assignments: delivery mode while a delivery is active, low-power online mode
 * while online and idle, stopped when offline. Starts only when background
 * permission is already granted (the disclosure is shown from the dashboard /
 * delivery screen, never from here). Returns whether background tracking is
 * running. Never throws.
 */
export async function syncDeliveryTracking(list: Assignment[], online: boolean): Promise<boolean> {
  const orderId = online ? pickTrackedOrderId(list) : null;
  try {
    return await setTrackingTarget({ online, orderId });
  } catch {
    return false;
  }
}

/** Re-read assignments from the server and sync (used when a delivery ends). */
export async function resyncDeliveryTracking(): Promise<void> {
  try {
    await syncDeliveryTracking(await api.assignments(), true);
  } catch {
    // Offline — the server will answer orderActive:false to the task instead.
  }
}

export type BackgroundTrackingStatus =
  /** Not on an active delivery. */
  | 'idle'
  /** Streaming in the background. */
  | 'active'
  /** Background permission not granted yet but can still be requested. */
  | 'needs-permission'
  /** Denied permanently — only the phone's Settings can turn it on. */
  | 'blocked';

export function useDeliveryTracking(opts: { orderId: string | null; active: boolean }) {
  const { orderId, active } = opts;
  const router = useRouter();
  const [status, setStatus] = useState<BackgroundTrackingStatus>('idle');

  const refresh = useCallback(async () => {
    if (!orderId) return; // still loading
    if (!active) {
      // Not (or no longer) an active delivery — delivered, closed by support,
      // or still a pending offer. Retarget to another live order or stop.
      setStatus('idle');
      await resyncDeliveryTracking();
      return;
    }
    if (await startDeliveryTracking(orderId)) {
      setStatus('active');
      return;
    }
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      const canAsk = bg.canAskAgain && fg.status !== 'denied';
      setStatus(canAsk ? 'needs-permission' : 'blocked');
      if (canAsk && !disclosureShown.has(orderId)) {
        disclosureShown.add(orderId);
        router.push({ pathname: '/location-disclosure', params: { orderId } });
      }
    } catch {
      setStatus('blocked');
    }
  }, [orderId, active, router]);

  // Runs on mount and whenever the screen regains focus (e.g. back from the
  // disclosure screen).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Re-check when the rider comes back from the disclosure / phone settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const openDisclosure = useCallback(() => {
    if (orderId) router.push({ pathname: '/location-disclosure', params: { orderId } });
  }, [orderId, router]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  return { status, refresh, openDisclosure, openSettings };
}
