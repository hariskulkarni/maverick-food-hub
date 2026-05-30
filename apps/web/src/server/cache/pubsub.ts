/**
 * Pub/sub bridge.
 *
 * Use cases:
 *
 *   1. Multi-instance SSE. The `realtime.ts` bus lives inside one Node
 *      process. If you run two pm2 workers, an event published in worker A
 *      never reaches an SSE subscriber attached to worker B. The bridge here
 *      relays every publish through Redis so all workers fan it out.
 *
 *   2. Cross-service signalling. Any future service (a background worker, a
 *      cron runner) can join the same channels without inheriting our
 *      EventEmitter implementation.
 *
 * The bridge is OPTIONAL. When REDIS_URL is unset (or Redis is down), publish
 * and subscribe become no-ops at the bridge level — the in-process bus still
 * works for the single-worker case. This means turning Redis off doesn't
 * break the app, only its cross-instance reach.
 */

import { getRuntime } from './client';
import { keys } from './keys';
import { log } from '../log';

export type PubSubHandler = (msg: unknown) => void;

const localHandlers = new Map<string, Set<PubSubHandler>>();
let subscribed = false;

/** Publish a JSON-serialisable message on `channel`. */
export async function publishMessage(channel: string, msg: unknown): Promise<void> {
  const { pub } = getRuntime();
  if (!pub) return; // memory backend → caller's in-process listeners handled elsewhere
  try {
    await pub.publish(keys.pubsubChannel(channel), JSON.stringify({ at: Date.now(), msg }));
  } catch (err) {
    log.warn({ err: (err as Error).message, channel }, '[cache] pubsub publish failed');
  }
}

/**
 * Attach a handler for `channel`. Returns an unsubscribe function. We
 * dispatch in-process on the same Redis connection — Redis fan-out is
 * O(subscribers), so we keep ONE Redis-side subscription per channel and
 * multiplex multiple JS handlers in this process onto it.
 */
export function subscribeMessage(channel: string, handler: PubSubHandler): () => void {
  const { sub } = getRuntime();
  if (!sub) return () => {};
  const wireChannel = keys.pubsubChannel(channel);

  let set = localHandlers.get(wireChannel);
  if (!set) {
    set = new Set();
    localHandlers.set(wireChannel, set);
    sub.subscribe(wireChannel).catch((err) => {
      log.warn({ err: (err as Error).message, channel }, '[cache] pubsub subscribe failed');
    });
  }
  set.add(handler);

  // Lazy: install the global "message" listener exactly once.
  if (!subscribed) {
    subscribed = true;
    sub.on('message', (incomingChannel, raw) => {
      const handlers = localHandlers.get(incomingChannel);
      if (!handlers || handlers.size === 0) return;
      let parsed: unknown;
      try {
        const env = JSON.parse(raw) as { msg: unknown };
        parsed = env.msg;
      } catch {
        parsed = raw;
      }
      for (const h of handlers) {
        try {
          h(parsed);
        } catch (err) {
          log.warn(
            { err: (err as Error).message, channel: incomingChannel },
            '[cache] pubsub handler threw',
          );
        }
      }
    });
  }

  return () => {
    const current = localHandlers.get(wireChannel);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      localHandlers.delete(wireChannel);
      sub.unsubscribe(wireChannel).catch(() => {});
    }
  };
}
