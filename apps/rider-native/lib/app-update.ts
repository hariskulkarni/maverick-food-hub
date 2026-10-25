/**
 * In-app update check.
 *
 * On launch and whenever the app returns to the foreground (throttled), asks
 * the backend's public GET /api/app/rider/latest which build is live for this
 * platform/channel and compares it with the RUNNING build's versionCode (read
 * via expo-application):
 *   - newer versionCode published       → dismissible "Update available" banner
 *   - running < minSupportedVersionCode → blocking "Update required" screen
 *                                         (SOS / emergency call stay available)
 * Dismissal is remembered per versionCode so the banner doesn't nag every
 * launch, but a newer release shows it again. Network errors fail quiet —
 * a rider is never blocked because the check itself couldn't run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './api';

export interface LatestRelease {
  versionName: string;
  versionCode: number;
  minSupportedVersionCode: number;
  downloadUrl: string;
  storeUrl: string | null;
  releaseNotes: string | null;
  fileSize: number | null;
  sha256: string | null;
  publishedAt: string;
}

export interface UpdateState {
  latest: LatestRelease | null;
  /** A newer build exists and the rider hasn't dismissed this version. */
  showBanner: boolean;
  /** Running build is below the minimum supported — block the app. */
  required: boolean;
  currentVersionName: string | null;
  currentVersionCode: number | null;
  dismiss: () => void;
  recheck: () => void;
}

const DISMISSED_KEY = 'flavrly_update_dismissed_code';
const RECHECK_MS = 10 * 60 * 1000;

/** The running build's versionCode (Android) / build number (iOS), or null. */
export function currentVersionCode(): number | null {
  const raw = Application.nativeBuildVersion;
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Pure comparison — mirrors updateStatus() on the server. */
export function compareUpdate(
  current: number | null,
  latest: { versionCode: number; minSupportedVersionCode: number } | null
): { updateAvailable: boolean; updateRequired: boolean } {
  if (!latest || current == null) return { updateAvailable: false, updateRequired: false };
  return {
    updateAvailable: latest.versionCode > current,
    updateRequired: current < latest.minSupportedVersionCode,
  };
}

async function fetchLatest(current: number | null): Promise<LatestRelease | null> {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const qs = `platform=${platform}&channel=stable${current != null ? `&versionCode=${current}` : ''}`;
  const res = await fetch(`${API_BASE}/api/app/rider/latest?${qs}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { latest?: LatestRelease | null };
  return body.latest ?? null;
}

export function useAppUpdate(): UpdateState {
  const current = currentVersionCode();
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [dismissedCode, setDismissedCode] = useState<number | null>(null);
  const lastCheck = useRef(0);

  const check = useCallback(async (force = false) => {
    if (Platform.OS === 'web') return;
    if (!force && Date.now() - lastCheck.current < RECHECK_MS) return;
    lastCheck.current = Date.now();
    try {
      setLatest(await fetchLatest(current));
    } catch {
      // Offline / server down — keep whatever we knew; never block on this.
    }
  }, [current]);

  useEffect(() => {
    SecureStore.getItemAsync(DISMISSED_KEY)
      .then((v) => setDismissedCode(v && /^\d+$/.test(v) ? Number(v) : null))
      .catch(() => {});
    check(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const { updateAvailable, updateRequired } = compareUpdate(current, latest);

  const dismiss = useCallback(() => {
    if (!latest) return;
    setDismissedCode(latest.versionCode);
    SecureStore.setItemAsync(DISMISSED_KEY, String(latest.versionCode)).catch(() => {});
  }, [latest]);

  return {
    latest,
    showBanner: updateAvailable && !updateRequired && dismissedCode !== latest?.versionCode,
    required: updateRequired,
    currentVersionName: Application.nativeApplicationVersion ?? null,
    currentVersionCode: current,
    dismiss,
    recheck: () => check(true),
  };
}
