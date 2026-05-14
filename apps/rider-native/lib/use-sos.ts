/**
 * useSos — the panic-button state hook.
 *
 * Owns the rider's currently ACTIVE SOS alert and the trigger / resolve
 * actions. `trigger` grabs a one-shot GPS fix (best-effort — an alert still
 * fires without it), buzzes the device, and POSTs to the SOS endpoint. While
 * an alert is live the hook polls every 15s so the UI stays in sync if the
 * alert is resolved from another surface (e.g. support).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { safety, type SosAlert } from './api-safety';

const POLL_MS = 15_000;

interface UseSosResult {
  activeAlert: SosAlert | null;
  loading: boolean;
  /** Triggers an SOS — captures GPS, fires haptics, POSTs. Resolves to the alert. */
  trigger: (assignmentId?: string, note?: string) => Promise<SosAlert>;
  /** Marks the active alert resolved ("I'm safe"). */
  resolve: (resolvedNote?: string) => Promise<void>;
}

/** Best-effort one-shot GPS fix — never throws, returns null if unavailable. */
async function getCurrentFix(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}

export function useSos(): UseSosResult {
  const [activeAlert, setActiveAlert] = useState<SosAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await safety.activeSos();
      if (mounted.current) setActiveAlert(res.active);
    } catch {
      // Network blip — keep the last known state rather than flickering empty.
    }
  }, []);

  // Initial load.
  useEffect(() => {
    mounted.current = true;
    (async () => {
      await refresh();
      if (mounted.current) setLoading(false);
    })();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Poll while an alert is live so a remote resolve reflects here.
  useEffect(() => {
    if (!activeAlert) return;
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [activeAlert, refresh]);

  const trigger = useCallback(
    async (assignmentId?: string, note?: string): Promise<SosAlert> => {
      // Buzz immediately — reassuring tactile confirmation under stress.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      const fix = await getCurrentFix();
      const res = await safety.triggerSos({
        lat: fix?.lat,
        lng: fix?.lng,
        assignmentId,
        note,
      });
      if (mounted.current) setActiveAlert(res.alert);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return res.alert;
    },
    []
  );

  const resolve = useCallback(
    async (resolvedNote?: string): Promise<void> => {
      if (!activeAlert) return;
      await safety.resolveSos(activeAlert.id, resolvedNote);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (mounted.current) setActiveAlert(null);
    },
    [activeAlert]
  );

  return { activeAlert, loading, trigger, resolve };
}
