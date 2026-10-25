/**
 * Fixed-bucket latency histogram. Upper bounds in ms; the last bucket is +Inf.
 * Fixed buckets make histograms mergeable by element-wise addition — across
 * minutes, across processes, and in SQL — which is what lets us store one row
 * per (minute, route) and still answer P50/P95/P99 over any range.
 *
 * Accuracy: a percentile is linearly interpolated inside its bucket, so the
 * error is bounded by the bucket width (≈ ±25% around the typical 50–500 ms range).
 */
export const BUCKETS_MS: readonly number[] = [
  5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000,
];
/** Length of a histogram array (one extra slot for > last bound). */
export const HIST_LEN = BUCKETS_MS.length + 1;

export function emptyHist(): number[] {
  return new Array(HIST_LEN).fill(0);
}

export function bucketIndex(ms: number): number {
  for (let i = 0; i < BUCKETS_MS.length; i++) if (ms <= BUCKETS_MS[i]) return i;
  return BUCKETS_MS.length;
}

export function addToHist(hist: number[], ms: number): void {
  hist[bucketIndex(ms)] += 1;
}

/** Element-wise sum into `into` (tolerates short / null arrays from old rows). */
export function mergeHist(into: number[], other: ReadonlyArray<number> | null | undefined): number[] {
  if (!other) return into;
  for (let i = 0; i < HIST_LEN; i++) into[i] += Number(other[i] ?? 0);
  return into;
}

/** Percentile (0–100) from a histogram; null when empty. `maxMs` caps the open bucket. */
export function percentile(hist: ReadonlyArray<number>, p: number, maxMs?: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = (p / 100) * total;
  let cum = 0;
  for (let i = 0; i < HIST_LEN; i++) {
    const c = hist[i] ?? 0;
    if (c === 0) continue;
    if (cum + c >= rank) {
      const lo = i === 0 ? 0 : BUCKETS_MS[i - 1];
      const hi = i < BUCKETS_MS.length ? BUCKETS_MS[i] : Math.max(maxMs ?? lo * 2, lo);
      const frac = c === 0 ? 0 : (rank - cum) / c;
      const v = lo + (hi - lo) * Math.min(Math.max(frac, 0), 1);
      return Math.round(maxMs !== undefined ? Math.min(v, maxMs) : v);
    }
    cum += c;
  }
  return maxMs ?? BUCKETS_MS[BUCKETS_MS.length - 1];
}
