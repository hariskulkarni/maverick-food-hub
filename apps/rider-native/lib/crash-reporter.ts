/**
 * Crash / error reporting for the rider app → the web backend's observability
 * beacon (POST /api/telemetry/client-error, source "rider-native").
 *
 * Installed by a side-effect import in app/_layout.tsx. Wraps React Native's
 * global ErrorUtils handler (uncaught JS errors, incl. fatal crashes) and, on
 * Hermes, the promise-rejection tracker. The previous handler is always called,
 * so the platform's red-box / crash behaviour is unchanged.
 *
 * Privacy: the server redacts tokens, OTPs, phones and e-mails; we additionally
 * never send the auth token or any request payloads. Throttled per app session.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE } from './api';

const ENDPOINT = `${API_BASE}/api/telemetry/client-error`;
const MAX_PER_SESSION = 15;
let sent = 0;
const seen = new Set<string>();

type ReportType = 'native-fatal' | 'native';

export function reportNativeError(err: unknown, type: ReportType = 'native', screen?: string): void {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const e = err as { message?: string; stack?: string } | null;
    const message = String(e?.message ?? (typeof err === 'string' ? err : 'Unknown error')).slice(0, 2000);
    const key = `${type}|${message}`;
    if (!message || seen.has(key)) return;
    seen.add(key);
    sent += 1;
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stack: e?.stack ? String(e.stack).slice(0, 8000) : null,
        source: 'rider-native',
        type,
        screen: screen ?? null,
        release: String(Constants.expoConfig?.version ?? '').slice(0, 60) || null,
        platform: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 40),
      }),
    }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsShape {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(h: GlobalHandler): void;
}

function install(): void {
  const g = globalThis as unknown as {
    ErrorUtils?: ErrorUtilsShape;
    HermesInternal?: { enablePromiseRejectionTracker?: (o: { allRejections: boolean; onUnhandled: (id: number, err: unknown) => void }) => void };
    __flavrlyCrashReporter?: boolean;
  };
  if (g.__flavrlyCrashReporter) return;
  g.__flavrlyCrashReporter = true;

  const eu = g.ErrorUtils;
  if (eu?.getGlobalHandler && eu.setGlobalHandler) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      reportNativeError(error, isFatal ? 'native-fatal' : 'native');
      previous?.(error, isFatal);
    });
  }
  try {
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, err) => reportNativeError(err, 'native'),
    });
  } catch {
    /* not on Hermes */
  }
}

if (!__DEV__) install();
