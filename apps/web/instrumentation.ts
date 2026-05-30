/**
 * Next.js boot hook.
 *
 * Runs once per Node process, BEFORE any request handler. This is where we
 * wire up the cross-module integrations that need to happen exactly once:
 *
 *   • Bring up the Redis-backed cache runtime (lazy connect — see client.ts).
 *   • Swap the rate-limit store from MemoryRateLimitStore → Redis-backed.
 *   • Bridge the realtime EventEmitter bus to Redis pub/sub (so two pm2
 *     workers share events).
 *   • Install a SIGTERM hook so a clean pm2 reload closes Redis connections.
 *
 * Each step is best-effort. If Redis is unreachable at boot, the in-memory
 * fallback path stays active — the app boots, serves traffic, and the cache
 * module's own retry logic reconnects when Redis comes back.
 *
 * Why one file: keeping ALL the cross-cutting boot wiring in one place makes
 * the "what does start-up do?" question answerable from one read.
 */

export async function register() {
  // Only run in the Node runtime — Next.js also calls this in the edge
  // runtime where Redis can't initialise.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { getCacheRuntime, buildRedisRateLimitStore } = await import('./src/server/cache');
  const { setRateLimitStore } = await import('./src/server/http/rate-limit');
  const { attachPubSubBridge } = await import('./src/server/realtime-pubsub');
  const { log } = await import('./src/server/log');

  const runtime = getCacheRuntime();

  // Print a single, scannable boot line so a `pm2 logs rm-web | head` tells
  // you exactly which backend the process picked.
  log.info(
    { backend: runtime.backend, prefix: runtime.prefix },
    `[boot] cache backend: ${runtime.backend}`,
  );

  if (runtime.backend === 'redis') {
    setRateLimitStore(buildRedisRateLimitStore());
    log.info({}, '[boot] rate-limit store: REDIS');
    attachPubSubBridge();
    log.info({}, '[boot] realtime bus: bridged to redis pub/sub');
  } else {
    log.info({}, '[boot] rate-limit store: MEMORY (no REDIS_URL)');
    log.info({}, '[boot] realtime bus: in-process only (no REDIS_URL)');
  }

  // Graceful shutdown — pm2 sends SIGTERM on `pm2 reload`. If we don't close
  // the Redis connections cleanly, ioredis logs a noisy "Connection is closed"
  // error during the next boot. Hook is idempotent.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, '[boot] cache: closing redis connections');
    await runtime.close();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
