/**
 * Realtime fan-out via in-process EventEmitter + per-connection SSE stream.
 * Swap to Postgres LISTEN/NOTIFY or Redis Pub/Sub for multi-instance deploys.
 *
 * Channels:
 *   order:{orderId}              — status changes, ETA updates, location pings
 *   branch:{branchId}:orders     — admin/kitchen feed
 *   branch:{branchId}:riders     — live rider positions for restaurant ops view
 *   rider:{riderId}              — assignments, pickups, deliveries
 *   platform:riders              — super-admin firehose of all rider positions
 *
 * In addition to fan-out, every published event is appended to an in-memory
 * ring buffer (cap RING_CAP per channel, oldest dropped). The poll endpoint
 * uses this so clients that can't hold an SSE connection (cheap hosting,
 * nginx without proxy_buffering off) can still receive recent events.
 */

import { EventEmitter } from 'node:events';

class Bus extends EventEmitter {}

declare global {
  // eslint-disable-next-line no-var
  var __bus: Bus | undefined;
  // eslint-disable-next-line no-var
  var __busBuffer: Map<string, BufferedEvent[]> | undefined;
  // eslint-disable-next-line no-var
  var __busSeq: { n: number } | undefined;
  // eslint-disable-next-line no-var
  var __batchExpirySweeper: ReturnType<typeof setInterval> | undefined;
}

export const bus = global.__bus ?? new Bus();
bus.setMaxListeners(0);
if (process.env.NODE_ENV !== 'production') global.__bus = bus;

export type RealtimeEvent =
  | { kind: 'status'; orderId: string; status: string; at: string }
  | { kind: 'eta'; orderId: string; readyAt?: string; deliveryAt?: string }
  | { kind: 'location'; orderId: string; lat: number; lng: number; at: string }
  | { kind: 'assigned'; orderId: string; riderId: string }
  | { kind: 'order:new'; orderId: string; branchId: string }
  | { kind: 'order:claimed'; orderId: string }
  // Lightweight rider position ping — fired every GPS update.
  | { kind: 'rider:position'; riderId: string; lat: number; lng: number; speedKph?: number; orderId?: string; at: string }
  // Proximity ping — rider has crossed inside ~200m of the customer drop point.
  // Debounced server-side so the customer only sees the "rider arriving" toast once.
  | { kind: 'rider:nearby'; orderId: string; distanceM: number; at: string };

export interface BufferedEvent {
  seq: number;
  at: string; // ISO timestamp the bus saw it
  event: RealtimeEvent;
}

const RING_CAP = 100;

const buffer: Map<string, BufferedEvent[]> = global.__busBuffer ?? new Map();
if (process.env.NODE_ENV !== 'production') global.__busBuffer = buffer;

const seqState = global.__busSeq ?? { n: 0 };
if (process.env.NODE_ENV !== 'production') global.__busSeq = seqState;

function appendToRing(channel: string, event: RealtimeEvent): BufferedEvent {
  const entry: BufferedEvent = { seq: ++seqState.n, at: new Date().toISOString(), event };
  const ring = buffer.get(channel);
  if (!ring) {
    buffer.set(channel, [entry]);
  } else {
    ring.push(entry);
    if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
  }
  return entry;
}

export function publish(channel: string, event: RealtimeEvent): void {
  appendToRing(channel, event);
  const listenerCount = bus.listenerCount(channel);
  bus.emit(channel, event);
  // Structured operational log so production drift ("orders not syncing")
  // is diagnosable without source access. Grep `pm2 logs rm-web | grep
  // bus.publish` to see every event + how many open SSE subscribers it
  // fanned out to. listenerCount=0 means the kitchen tab isn't connected
  // (closed laptop, nginx blocking, etc.) — the polling fallback should
  // pick it up on the next poll, but it's the first thing to check when
  // sync seems broken.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    msg: 'bus.publish',
    channel,
    kind: event.kind,
    listenerCount,
    orderId: 'orderId' in event ? event.orderId : undefined,
    riderId: 'riderId' in event ? event.riderId : undefined,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Background ticker — BatchInvitation TTL sweep.
//
// Every 5 seconds we flip stale PENDING invitations to EXPIRED. The interval
// is parked on globalThis so Next.js dev HMR doesn't spawn duplicate timers
// after every recompile. Single source: when this module first loads in a
// process, exactly one sweeper runs for the lifetime of that process.
//
// Hosted here (rather than in batch-expiry.ts) because realtime.ts is already
// a module-level singleton wired into every SSE-bearing route, so it's the
// natural place for any always-on background work. To run the sweeper from a
// route handler (e.g. tests), call `expireStaleBatchInvitations()` directly.
// ─────────────────────────────────────────────────────────────────────────────
const BATCH_EXPIRY_INTERVAL_MS = 5_000;
if (!global.__batchExpirySweeper) {
  // Dynamic import so realtime.ts (which is imported during build by route
  // handlers) doesn't pull in @prisma/client when Next.js is statically
  // analysing pages — Prisma's bootstrap is heavier than the bus needs.
  global.__batchExpirySweeper = setInterval(() => {
    import('./batch-expiry')
      .then((m) => m.expireStaleBatchInvitations())
      .catch(() => {
        /* swallow — the sweeper retries on the next tick */
      });
  }, BATCH_EXPIRY_INTERVAL_MS);
  // Don't let this timer keep a serverless lambda alive past request end.
  if (typeof global.__batchExpirySweeper.unref === 'function') {
    global.__batchExpirySweeper.unref();
  }
}

/**
 * Fetch events newer than `since` (ISO string) from the in-memory ring.
 * If `since` is empty/invalid, returns the whole current ring.
 * Returns chronological order (oldest first).
 */
export function getBufferedSince(channel: string, since?: string | null): BufferedEvent[] {
  const ring = buffer.get(channel);
  if (!ring || ring.length === 0) return [];
  if (!since) return ring.slice();
  const t = Date.parse(since);
  if (Number.isNaN(t)) return ring.slice();
  return ring.filter((e) => Date.parse(e.at) > t);
}
