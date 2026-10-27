/** Path reconstruction math for rider insights (server/rider-insights/path.ts). */
import { describe, it, expect } from 'vitest';
import { avgSpeedKph, BREAK_GAP_MS, downsample, GAP_MS, haversineM, reconstructPath, type PathPoint } from '@/server/rider-insights/path';

// ~111.2 m per 0.001° of latitude.
const LAT0 = 16.3;
const LNG0 = 80.4;
const north = (m: number) => LAT0 + m / 111_195;
const T0 = Date.UTC(2026, 9, 27, 10, 0, 0);
const pt = (metersNorth: number, sec: number, extra: Partial<PathPoint> = {}): PathPoint => ({ lat: north(metersNorth), lng: LNG0, t: T0 + sec * 1000, ...extra });

describe('haversineM', () => {
  it('measures 1 km of latitude as ~1 km', () => {
    expect(haversineM({ lat: LAT0, lng: LNG0 }, { lat: north(1000), lng: LNG0 })).toBeGreaterThan(995);
    expect(haversineM({ lat: LAT0, lng: LNG0 }, { lat: north(1000), lng: LNG0 })).toBeLessThan(1005);
  });
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
});

describe('reconstructPath', () => {
  it('sums a straight ride and orders points by time', () => {
    // 2 km north in 100 m steps every 10 s (36 km/h), shuffled input.
    const pts = Array.from({ length: 21 }, (_, i) => pt(i * 100, i * 10));
    const s = reconstructPath([...pts].reverse());
    expect(s.points[0].t).toBe(T0);
    expect(s.distanceM).toBeGreaterThan(1990);
    expect(s.distanceM).toBeLessThan(2010);
    expect(s.durationMs).toBe(200_000);
    expect(s.movingMs).toBe(200_000);
    expect(avgSpeedKph(s.distanceM, s.movingMs)).toBeCloseTo(36, 0);
    expect(s.droppedPoints).toBe(0);
    expect(s.maxGapMs).toBe(10_000);
    expect(s.gapCount).toBe(0);
  });

  it('drops a GPS jump (impossible speed) as an outlier', () => {
    const pts = [pt(0, 0), pt(100, 10), pt(5000, 15) /* 5 km in 5 s */, pt(200, 20), pt(300, 30)];
    const s = reconstructPath(pts);
    expect(s.droppedPoints).toBe(1);
    expect(s.pointCount).toBe(4);
    expect(s.distanceM).toBeGreaterThan(295);
    expect(s.distanceM).toBeLessThan(305);
  });

  it('does not add parked-phone jitter (< 15 m wander) to the distance', () => {
    const wander = [0, 4, -3, 6, -5, 2, 7, -6, 3, 0].map((m, i) => pt(m, i * 15));
    const s = reconstructPath(wander);
    expect(s.distanceM).toBe(0);
    expect(s.movingMs).toBe(0);
  });

  it('counts gaps and never bridges a long silence with invented distance', () => {
    const pts = [
      pt(0, 0),
      pt(100, 10),
      pt(300, 10 + GAP_MS / 1000 + 20), // 2m20s gap — counted, still bridged
      pt(5000, 10 + GAP_MS / 1000 + 20 + BREAK_GAP_MS / 1000 + 60), // > 10 min later, 4.7 km away — path break
      pt(5100, 10 + GAP_MS / 1000 + 20 + BREAK_GAP_MS / 1000 + 70),
    ];
    const s = reconstructPath(pts);
    expect(s.gapCount).toBe(2);
    expect(s.maxGapMs).toBe(BREAK_GAP_MS + 60_000);
    // 100 + 200 + 100 m; the 4.7 km across the break is not counted.
    expect(s.distanceM).toBeGreaterThan(395);
    expect(s.distanceM).toBeLessThan(405);
  });

  it('ignores non-finite points and handles empty / single input', () => {
    expect(reconstructPath([]).distanceM).toBe(0);
    expect(reconstructPath([]).startedAt).toBeNull();
    const one = reconstructPath([pt(0, 0), { lat: NaN, lng: 1, t: T0 }]);
    expect(one.pointCount).toBe(1);
    expect(one.droppedPoints).toBe(1);
    expect(one.durationMs).toBe(0);
  });

  it('drops duplicate timestamps', () => {
    const s = reconstructPath([pt(0, 0), pt(50, 0), pt(100, 10)]);
    expect(s.pointCount).toBe(2);
    expect(s.droppedPoints).toBe(1);
  });
});

describe('avgSpeedKph / downsample', () => {
  it('avg speed is 0 without moving time', () => {
    expect(avgSpeedKph(1000, 0)).toBe(0);
    expect(avgSpeedKph(10_000, 30 * 60_000)).toBe(20);
  });
  it('downsample keeps first and last and caps length', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(arr, 10);
    expect(d).toHaveLength(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(999);
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
