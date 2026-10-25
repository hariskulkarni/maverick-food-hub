/**
 * Background location tracking for an active delivery.
 *
 * While the rider has an accepted / picked-up assignment we run
 * Location.startLocationUpdatesAsync with an expo-task-manager task, so GPS
 * keeps flowing to POST /api/rider/location (the same endpoint the foreground
 * hook uses, which feeds the customer tracker, live-ops and /trip/<token>)
 * even when the rider switches to Google Maps or locks the phone.
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
  orderId: string;
}

interface TrackingState {
  orderId: string | null;
  queue: QueuedPoint[];
}

// ─── Persistent state (serialised through one promise chain) ────────────────

let chain: Promise<unknown> = Promise.resolve();

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

async function readState(): Promise<TrackingState> {
  try {
    const f = stateFile();
    if (!f.exists) return { orderId: null, queue: [] };
    const parsed = JSON.parse(await f.text()) as Partial<TrackingState>;
    return {
      orderId: typeof parsed.orderId === 'string' ? parsed.orderId : null,
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
  } catch {
    return { orderId: null, queue: [] };
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

const pointKey = (p: QueuedPoint) => `${p.orderId}:${p.recordedAt}:${p.lat}:${p.lng}`;

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
        await stopDeliveryTracking({ clearQueue: true });
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
          // Delivered, cancelled, closed by support or reassigned.
          await stopDeliveryTracking();
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
    if (!state.orderId) {
      // Nothing to track (e.g. the app was killed mid-stop) — shut it down.
      await stopUpdates();
      return;
    }
    const orderId = state.orderId;
    const points: QueuedPoint[] = locations
      .filter((l) => Number.isFinite(l.coords.latitude) && Number.isFinite(l.coords.longitude))
      .map((l) => {
        const speed = l.coords.speed;
        return {
          lat: l.coords.latitude,
          lng: l.coords.longitude,
          ...(speed != null && speed >= 0 ? { speedKph: speed * 3.6 } : {}),
          recordedAt: Math.round(l.timestamp || Date.now()),
          orderId,
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
}

export async function hasBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Start (or retarget) background tracking for `orderId`. Returns false when
 * background permission isn't granted or the OS refused — the caller then
 * falls back to foreground-only tracking. Must be called with the app in the
 * foreground (Android won't start a foreground service from the background).
 */
export async function startDeliveryTracking(orderId: string): Promise<boolean> {
  try {
    if (!(await hasBackgroundPermission())) {
      bgActive = false;
      return false;
    }
    await mutateState((s) => ({ ...s, orderId }));
    if (!(await Location.hasStartedLocationUpdatesAsync(DELIVERY_LOCATION_TASK))) {
      await Location.startLocationUpdatesAsync(DELIVERY_LOCATION_TASK, TRACKING_OPTIONS);
    }
    bgActive = true;
    return true;
  } catch {
    bgActive = false;
    return false;
  }
}

/** Stop background tracking. `clearQueue` also discards unsent points (sign-out). */
export async function stopDeliveryTracking(opts: { clearQueue?: boolean } = {}): Promise<void> {
  await mutateState((s) => ({ orderId: null, queue: opts.clearQueue ? [] : s.queue })).catch(() => {});
  await stopUpdates();
  // Try to deliver whatever was still queued (no-op if a flush is running).
  if (!opts.clearQueue) void flushQueue().catch(() => {});
}
