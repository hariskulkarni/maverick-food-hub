/**
 * Background location tracking while the rider is ONLINE.
 *
 * Two modes, one expo-task-manager task (Location.startLocationUpdatesAsync):
 *   - online (idle): a low-power fix about every 30 s, posted untagged, so an
 *     online rider whose phone is locked or who is in another app stays on the
 *     fleet map and is not flipped offline by the server's 2-minute auto-offline
 *     sweep (every accepted location refreshes RiderHeartbeat.lastSeenAt).
 *     Before this mode existed, an idle rider's heartbeat and GPS both stopped
 *     the moment the app left the screen, and the sweep took them offline while
 *     the app still showed "Online".
 *   - delivery: while the rider has an accepted / picked-up assignment, GPS
 *     every 15 s / 30 m tagged with the order, so the customer tracker,
 *     live-ops and /trip/<token> keep moving even when the rider switches to
 *     Google Maps or locks the phone.
 * Both post to POST /api/rider/location (the same endpoint the foreground hook
 * uses). Background permission ("Allow all the time") is required; without it
 * the app falls back to foreground-only tracking.
 *
 *   Android: a foreground service with a persistent notification
 *            ("Flavrly is sharing your location for an active delivery").
 *   iOS:     UIBackgroundModes=location + the blue status-bar indicator.
 *
 * The task runs outside React (possibly in a fresh JS runtime after the OS
 * relaunches the app), so everything it needs lives here:
 *   - the active orderId + an offline point queue in a JSON file in the app's
 *     document directory (FIFO, capped at MAX_QUEUE, flushed oldest-first in
 *     batches of BATCH_SIZE);
 *   - a copy of the rider Bearer token in secure storage with
 *     AFTER_FIRST_UNLOCK accessibility, so it can be read while the phone is
 *     locked. No token → nothing is sent (points stay queued), never a crash.
 *
 * Tracking stops automatically when: the app reports no active assignment,
 * the rider goes offline or signs out, the server answers `orderActive:false`
 * (delivered / cancelled / closed by support / reassigned), or the server
 * rejects the token (401/403).
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { API_BASE, getAuthToken } from './api';

export const DELIVERY_LOCATION_TASK = 'flavrly-delivery-location';

const BG_TOKEN_KEY = 'flavrly_rider_token_bg';
const STATE_FILE = 'delivery-tracking.json';
/** Max points kept while offline (~2 h at one point per 15 s). Oldest dropped first. */
export const MAX_QUEUE = 500;
/** Points per POST — must match the server's batch cap. */
export const BATCH_SIZE = 50;
/** Max POSTs per flush, so a long backlog can't keep the task awake forever. */
const MAX_ROUNDS_PER_FLUSH = 6;

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * Online but idle: balanced (Wi-Fi / cell assisted) fix every ~30 s with no
 * distance filter, so a rider waiting outside a restaurant still checks in
 * well inside the server's 2-minute window. Light on the battery.
 */
const ONLINE_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 30_000,
  distanceInterval: 0,
  // iOS
  activityType: Location.ActivityType.Other,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  // Android
  foregroundService: {
    notificationTitle: "You're online",
    notificationBody: 'Flavrly is sharing your location so you can receive orders. Go offline to stop.',
    notificationColor: '#f23e5c',
    killServiceOnDestroy: false,
  },
};

/**
 * Battery-sensible settings for an active delivery. High accuracy (GPS) is
 * used because the customer map and the 200 m arrival geofence need it, and
 * the rider usually has Google Maps navigating anyway (GPS already on); the
 * 15 s / 30 m filter keeps the wake-ups and uploads low.
 */
const TRACKING_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 15_000,
  distanceInterval: 30,
  // iOS
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  // Android
  foregroundService: {
    notificationTitle: 'Delivery in progress',
    notificationBody: 'Flavrly is sharing your location for an active delivery.',
    notificationColor: '#f23e5c',
    killServiceOnDestroy: false,
  },
};

export interface QueuedPoint {
  lat: number;
  lng: number;
  speedKph?: number;
  /** Fix time, ms since epoch. */
  recordedAt: number;
  /** Absent for idle (online, no delivery) points. */
  orderId?: string;
}

interface TrackingState {
  /** Rider is online: keep tracking even with no delivery. */
  online: boolean;
  orderId: string | null;
  queue: QueuedPoint[];
}

const EMPTY_STATE: TrackingState = { online: false, orderId: null, queue: [] };

// ─── Persistent state (serialised through one promise chain) ────────────────

let chain: Promise<unknown> = Promise.resolve();

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

async function readState(): Promise<TrackingState> {
  try {
    const f = stateFile();
    if (!f.exists) return { ...EMPTY_STATE };
    const parsed = JSON.parse(await f.text()) as Partial<TrackingState>;
    const orderId = typeof parsed.orderId === 'string' ? parsed.orderId : null;
    return {
      // Older state files have no `online`: a stored order implies online.
      online: typeof parsed.online === 'boolean' ? parsed.online : !!orderId,
      orderId,
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(s: TrackingState): void {
  try {
    const f = stateFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s));
  } catch {
    // Best effort — a full disk must never crash tracking.
  }
}

/** Apply `fn` to the stored state atomically (within this JS runtime). */
function mutateState(fn: (s: TrackingState) => TrackingState): Promise<TrackingState> {
  const next = chain.then(async () => {
    const updated = fn(await readState());
    writeState(updated);
    return updated;
  });
  chain = next.catch(() => {});
  return next;
}

/** Append points, keeping only the newest MAX_QUEUE. Pure — exported for tests. */
export function appendCapped(queue: QueuedPoint[], points: QueuedPoint[], cap = MAX_QUEUE): QueuedPoint[] {
  const merged = queue.concat(points);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

const pointKey = (p: QueuedPoint) => `${p.orderId ?? '-'}:${p.recordedAt}:${p.lat}:${p.lng}`;

// ─── Token ──────────────────────────────────────────────────────────────────

/** Called by lib/auth.ts on sign-in / restore (token) and sign-out (null). */
export async function saveBackgroundToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(BG_TOKEN_KEY, token, SECURE_OPTS);
    else await SecureStore.deleteItemAsync(BG_TOKEN_KEY, SECURE_OPTS);
  } catch {
    // ignore — the task just won't be able to send until the next sign-in.
  }
}

async function readToken(): Promise<string | null> {
  const mem = getAuthToken();
  if (mem) return mem;
  try {
    return await SecureStore.getItemAsync(BG_TOKEN_KEY, SECURE_OPTS);
  } catch {
    return null;
  }
}

// ─── Upload ─────────────────────────────────────────────────────────────────

let flushing = false;

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const token = await readToken();
    if (!token) return; // signed out / keychain unavailable — keep the queue

    for (let round = 0; round < MAX_ROUNDS_PER_FLUSH; round++) {
      const { queue } = await readState();
      if (queue.length === 0) return;
      const batch = queue.slice(0, BATCH_SIZE);

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/rider/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // sentAt lets the server correct for a wrong phone clock.
          body: JSON.stringify({ points: batch, sentAt: Date.now() }),
        });
      } catch {
        return; // offline — retry on the next fix
      }

      if (res.status === 401 || res.status === 403) {
        // Token rejected: the rider is signed out or deactivated.
        await stopAllTracking({ clearQueue: true });
        return;
      }
      if (res.status === 429 || res.status >= 500) return; // retry later

      // 2xx, or a 4xx the server will never accept → drop the batch.
      const sent = new Set(batch.map(pointKey));
      await mutateState((s) => ({ ...s, queue: s.queue.filter((p) => !sent.has(pointKey(p))) }));

      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { orderActive?: boolean } | null;
        const state = await readState();
        const newest = batch[batch.length - 1];
        if (body?.orderActive === false && state.orderId && newest.orderId === state.orderId) {
          // Delivered, cancelled, closed by support or reassigned. Stop tagging
          // points with that order; keep tracking if the rider is still online
          // (the next foreground sync switches back to the low-power settings —
          // Android won't restart a foreground service from the background).
          if (state.online) {
            await mutateState((st) => ({ ...st, orderId: st.orderId === newest.orderId ? null : st.orderId }));
          } else {
            await stopAllTracking();
          }
          return;
        }
      }
    }
  } finally {
    flushing = false;
  }
}

// ─── The background task ────────────────────────────────────────────────────

// Must be defined at module scope and imported from the root layout, so the
// task exists whenever the OS wakes the app to deliver locations.
TaskManager.defineTask(DELIVERY_LOCATION_TASK, async ({ data, error }) => {
  try {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    const state = await readState();
    if (!state.online && !state.orderId) {
      // Nothing to track (offline, or the app was killed mid-stop) — shut it down.
      await stopUpdates();
      return;
    }
    const orderId = state.orderId ?? undefined;
    const points: QueuedPoint[] = locations
      .filter((l) => Number.isFinite(l.coords.latitude) && Number.isFinite(l.coords.longitude))
      .map((l) => {
        const speed = l.coords.speed;
        return {
          lat: l.coords.latitude,
          lng: l.coords.longitude,
          ...(speed != null && speed >= 0 ? { speedKph: speed * 3.6 } : {}),
          recordedAt: Math.round(l.timestamp || Date.now()),
          ...(orderId ? { orderId } : {}),
        };
      });
    if (points.length) await mutateState((s) => ({ ...s, queue: appendCapped(s.queue, points) }));
    await flushQueue();
  } catch {
    // A background task must never throw.
  }
});

// ─── Control API (used by the app) ──────────────────────────────────────────

let bgActive = false;
let runningMode: 'online' | 'delivery' | null = null;

/** True while the background task is streaming — foreground hooks then stay quiet. */
export function isBackgroundTrackingActive(): boolean {
  return bgActive;
}

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(DELIVERY_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
    }
  } catch {
    // Task not registered / module unavailable — nothing to stop.
  }
  bgActive = false;
  runningMode = null;
}

export async function hasBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/** Which background settings a target needs (pure — exported for tests). */
export function trackingMode(target: { online: boolean; orderId: string | null }): 'online' | 'delivery' | null {
  if (target.orderId) return 'delivery';
  return target.online ? 'online' : null;
}

/**
 * Bring background tracking in line with the rider's state: offline → stop;
 * online with a delivery → delivery settings, tagged with the order; online
 * and idle → low-power online settings. Returns false when background
 * permission isn't granted or the OS refused — the caller then relies on
 * foreground-only tracking. Must be called with the app in the foreground
 * (Android won't start a foreground service from the background).
 */
export async function setTrackingTarget(target: { online: boolean; orderId: string | null }): Promise<boolean> {
  const mode = trackingMode(target);
  if (!mode) {
    await stopAllTracking();
    return false;
  }
  try {
    if (!(await hasBackgroundPermission())) {
      bgActive = false;
      return false;
    }
    await mutateState((s) => ({ ...s, online: target.online || !!target.orderId, orderId: target.orderId }));
    const started = await Location.hasStartedLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
    if (started && runningMode !== mode) {
      // Switch settings (idle ⇄ delivery): restart the updates with the new options.
      await Location.stopLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
    }
    if (!started || runningMode !== mode) {
      await Location.startLocationUpdatesAsync(
        DELIVERY_LOCATION_TASK,
        mode === 'delivery' ? TRACKING_OPTIONS : ONLINE_OPTIONS
      );
    }
    runningMode = mode;
    bgActive = true;
    return true;
  } catch {
    bgActive = false;
    return false;
  }
}

/** Track an accepted delivery (implies online). */
export function startDeliveryTracking(orderId: string): Promise<boolean> {
  return setTrackingTarget({ online: true, orderId });
}

/** Track an online rider with no delivery. */
export function startOnlineTracking(): Promise<boolean> {
  return setTrackingTarget({ online: true, orderId: null });
}

/** Stop all background tracking (going offline, sign-out). `clearQueue` also discards unsent points. */
export async function stopAllTracking(opts: { clearQueue?: boolean } = {}): Promise<void> {
  await mutateState((s) => ({ online: false, orderId: null, queue: opts.clearQueue ? [] : s.queue })).catch(() => {});
  await stopUpdates();
  // Try to deliver whatever was still queued (no-op if a flush is running).
  if (!opts.clearQueue) void flushQueue().catch(() => {});
}

/** @deprecated name kept for existing callers — stops ALL background tracking. */
export const stopDeliveryTracking = stopAllTracking;
