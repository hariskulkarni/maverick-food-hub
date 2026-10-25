/**
 * Rate limiter for the public client-error beacon: per IP and per process.
 * In-memory on purpose (single `next start` process); bounded map.
 */
const PER_IP = 20;
const GLOBAL_CAP = 300;
const WINDOW_MS = 60_000;

const hits = new Map<string, { n: number; reset: number }>();
let total = { n: 0, reset: 0 };

export function allowBeacon(ip: string, now = Date.now()): boolean {
  if (total.reset <= now) total = { n: 0, reset: now + WINDOW_MS };
  if (total.n >= GLOBAL_CAP) return false;
  const h = hits.get(ip);
  if (!h || h.reset <= now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
  } else {
    if (h.n >= PER_IP) return false;
    h.n += 1;
  }
  total.n += 1;
  return true;
}

/** Test hook. */
export function resetBeaconLimits(): void {
  hits.clear();
  total = { n: 0, reset: 0 };
}
