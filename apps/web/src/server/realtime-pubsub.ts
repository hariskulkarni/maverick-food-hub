/**
 * Realtime ↔ Redis pub/sub bridge.
 *
 * The realtime bus in `realtime.ts` is a process-local EventEmitter. Behind a
 * single pm2 worker that's fine — every SSE client lives in the same
 * process. The moment we run two workers (or a worker + a cron service), an
 * event fired in process A doesn't reach a subscriber attached in process B.
 *
 * This bridge runs in BOTH directions:
 *
 *   • OUTBOUND: every `publish(channel, event)` we observe is forwarded to
 *     Redis on a parallel pub/sub channel, tagged with this process's unique
 *     origin id.
 *
 *   • INBOUND: we subscribe to the same channel pattern. Messages tagged
 *     with OUR origin are dropped (we already emitted them locally). Anyone
 *     else's messages are re-emitted on our local bus, which fans them out
 *     to our SSE subscribers transparently.
 *
 * The result: any process that imports realtime.ts and runs this bridge
 * sees every event published by any other peer, without the realtime.ts
 * callers needing to know Redis exists.
 *
 * Channel mapping: the bus uses dynamic channels like `order:abc` or
 * `branch:xyz:orders`. We mirror them onto Redis under a single namespace
 * (`bus:<channel>`) and use Redis PSUBSCRIBE on `bus:*` so we don't have to
 * track every active channel.
 */

import { randomBytes } from 'node:crypto';
import { bus, type RealtimeEvent, type BufferedEvent } from './realtime';
import { getCacheRuntime } from './cache';
import { keys } from './cache/keys';
import { log } from './log';

/** A unique-per-process id so we can ignore our own echo. */
const ORIGIN = randomBytes(6).toString('hex');

interface WireMessage {
  origin: string;
  channel: string;
  event: RealtimeEvent;
}

const WIRE_PREFIX = 'bus:';

let attached = false;

/**
 * Wire the bridge. Idempotent — calling twice is harmless because we guard
 * with `attached`. Boot calls this exactly once via instrumentation.ts.
 */
export function attachPubSubBridge(): void {
  if (attached) return;
  attached = true;

  const runtime = getCacheRuntime();
  if (runtime.backend !== 'redis' || !runtime.pub || !runtime.sub) {
    // Memory mode → nothing to bridge.
    return;
  }
  const { pub, sub } = runtime;

  // ── OUTBOUND ──────────────────────────────────────────────────────────────
  // We hook the same EventEmitter that realtime.ts emits on. Listening on a
  // specific channel requires knowing the channel name; rather than listening
  // on every channel we'd ever use (impossible — they're dynamic), we monkey-
  // patch the `emit` once so EVERY bus.emit goes through here.
  const originalEmit = bus.emit.bind(bus);
  bus.emit = function patched(eventName: string | symbol, ...args: unknown[]) {
    // Always do the local fan-out first so existing SSE behaviour is unchanged.
    const result = originalEmit(eventName as string, ...(args as [unknown]));
    // Only mirror real bus channels (skip 'newListener', 'removeListener', etc.).
    if (typeof eventName === 'string' && !eventName.startsWith('__') && args.length > 0) {
      const event = args[0] as RealtimeEvent;
      const wire: WireMessage = { origin: ORIGIN, channel: eventName, event };
      pub.publish(keys.pubsubChannel(WIRE_PREFIX + eventName), JSON.stringify(wire)).catch((err) => {
        log.warn({ err: (err as Error).message, channel: eventName }, '[bus] redis publish failed');
      });
    }
    return result;
  };

  // ── INBOUND ───────────────────────────────────────────────────────────────
  // PSUBSCRIBE on every bus channel under our pubsub namespace. We can't use
  // sub.psubscribe + a wildcard handler if we also call subscribeMessage()
  // from cache/pubsub.ts on the same client, so we share the connection
  // carefully: psubscribe gets its own `pmessage` event, regular subscribe
  // emits `message`. They coexist.
  const pattern = keys.pubsubChannel(WIRE_PREFIX + '*');
  sub.psubscribe(pattern).catch((err) => {
    log.warn({ err: (err as Error).message, pattern }, '[bus] psubscribe failed');
  });
  sub.on('pmessage', (_pattern, _channel, raw) => {
    try {
      const wire = JSON.parse(raw) as WireMessage;
      // Drop our own echo so we don't fan the same event out twice locally.
      if (wire.origin === ORIGIN) return;
      originalEmit(wire.channel, wire.event);
    } catch (err) {
      log.warn({ err: (err as Error).message }, '[bus] inbound message parse failed');
    }
  });

  log.info({ origin: ORIGIN, pattern }, '[bus] redis bridge attached');
}

/** Used by tests / diag pages. Returns the origin id so the diag UI can
 *  show "Worker X published this". */
export function getBusOrigin(): string {
  return ORIGIN;
}

/** Strictly for the diag panel. Lifted out of realtime.ts to avoid a
 *  circular import — the realtime module pulls in cache via this bridge. */
export type { BufferedEvent };
