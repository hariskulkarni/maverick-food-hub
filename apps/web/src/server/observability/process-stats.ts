/**
 * Live process gauges: memory, event-loop delay (from perf_hooks), uptime,
 * release. The event-loop histogram is rolled every minute so the numbers
 * describe the last minute, not the whole process lifetime.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { appRelease } from './store';

interface LoopState {
  h: IntervalHistogram;
  last: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number; at: number } | null;
  timer: ReturnType<typeof setInterval>;
}

declare global {
  // eslint-disable-next-line no-var
  var __obsLoop: LoopState | undefined;
}

const ns = (v: number) => Math.round((v / 1e6) * 10) / 10;

export function startEventLoopMonitor(): void {
  if (global.__obsLoop) return;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const roll = () => {
    const s = global.__obsLoop;
    if (!s) return;
    s.last = { p50Ms: ns(h.percentile(50)), p99Ms: ns(h.percentile(99)), maxMs: ns(h.max), meanMs: ns(h.mean), at: Date.now() };
    h.reset();
  };
  const timer = setInterval(roll, 60_000);
  timer.unref?.();
  global.__obsLoop = { h, last: null, timer };
}

export function processSnapshot() {
  const mem = process.memoryUsage();
  const loop = global.__obsLoop;
  const live = loop
    ? { p50Ms: ns(loop.h.percentile(50)), p99Ms: ns(loop.h.percentile(99)), maxMs: ns(loop.h.max), meanMs: ns(loop.h.mean) }
    : null;
  return {
    pid: process.pid,
    nodeVersion: process.version,
    uptimeSec: Math.round(process.uptime()),
    release: appRelease(),
    env: process.env.NODE_ENV ?? 'development',
    demoMode: process.env.DEMO_MODE === 'true',
    memory: {
      rssMB: Math.round(mem.rss / 1048576),
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      externalMB: Math.round(mem.external / 1048576),
    },
    eventLoop: { lastMinute: loop?.last ?? null, sinceLastRoll: live },
  };
}
