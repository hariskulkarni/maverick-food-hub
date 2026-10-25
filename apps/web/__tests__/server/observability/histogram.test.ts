import { describe, it, expect } from 'vitest';
import { emptyHist, addToHist, mergeHist, percentile, bucketIndex, HIST_LEN, BUCKETS_MS } from '@/server/observability/histogram';

describe('latency histogram', () => {
  it('buckets by upper bound with an overflow slot', () => {
    expect(bucketIndex(0)).toBe(0);
    expect(bucketIndex(5)).toBe(0);
    expect(bucketIndex(6)).toBe(1);
    expect(bucketIndex(999999)).toBe(BUCKETS_MS.length);
    expect(emptyHist()).toHaveLength(HIST_LEN);
  });
  it('computes interpolated percentiles', () => {
    const h = emptyHist();
    for (let i = 0; i < 90; i++) addToHist(h, 40); // bucket 25–50
    for (let i = 0; i < 10; i++) addToHist(h, 900); // bucket 750–1000
    const p50 = percentile(h, 50)!;
    const p95 = percentile(h, 95)!;
    expect(p50).toBeGreaterThan(25);
    expect(p50).toBeLessThanOrEqual(50);
    expect(p95).toBeGreaterThan(750);
    expect(p95).toBeLessThanOrEqual(1000);
    expect(percentile(emptyHist(), 50)).toBeNull();
  });
  it('caps the open bucket at the observed max and merges element-wise', () => {
    const h = emptyHist();
    addToHist(h, 45_000);
    expect(percentile(h, 99, 45_000)).toBeLessThanOrEqual(45_000);
    const merged = mergeHist(emptyHist(), h);
    mergeHist(merged, h);
    expect(merged[BUCKETS_MS.length]).toBe(2);
    expect(mergeHist(emptyHist(), null)).toEqual(emptyHist());
  });
});
