/**
 * Server-side spoofing heuristics (pure). Each anti-fraud signal is tested in
 * isolation, plus that honest movement raises nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateSpoof,
  distanceM,
  isRoundAccuracy,
  TELEPORT_DIST_M,
  type SpoofPoint,
} from '@/server/rider-integrity/heuristics';

const t0 = 1_700_000_000_000;
const p = (lat: number, lng: number, dtSec: number, accuracy?: number): SpoofPoint => ({
  lat,
  lng,
  t: t0 + dtSec * 1000,
  ...(accuracy !== undefined ? { accuracy } : {}),
});
const kinds = (sigs: { kind: string }[]) => sigs.map((s) => s.kind);

describe('distanceM', () => {
  it('~111 km per degree of latitude', () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110_000);
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(112_000);
  });
});

describe('teleport', () => {
  it('flags a >2 km jump in <30 s', () => {
    // ~3 km north in 10 s.
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.927, 77.6, 10)] });
    expect(kinds(sigs)).toContain('TELEPORT');
  });
  it('does not flag the same jump spread over 5 minutes', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.927, 77.6, 300)] });
    expect(kinds(sigs)).not.toContain('TELEPORT');
  });
  it('uses the previous fix for the first point', () => {
    const prev = p(12.9, 77.6, -5);
    const sigs = evaluateSpoof({ prev, points: [p(12.95, 77.6, 0)] });
    expect(kinds(sigs)).toContain('TELEPORT');
  });
});

describe('impossible speed', () => {
  it('flags sustained >120 km/h over a real segment', () => {
    // ~1 km in 20 s = 180 km/h.
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.909, 77.6, 20)] });
    expect(kinds(sigs)).toContain('IMPOSSIBLE_SPEED');
  });
  it('ignores a tiny jittery segment below the distance floor', () => {
    // ~5 m in 0.1 s would be fast, but under SPEED_MIN_SEGMENT_M → ignored.
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.90005, 77.6, 0.1)] });
    expect(kinds(sigs)).not.toContain('IMPOSSIBLE_SPEED');
  });
});

describe('repeated identical coordinates', () => {
  it('flags 4+ pings at the exact same point', () => {
    const sigs = evaluateSpoof({
      prev: null,
      points: [p(12.9, 77.6, 0), p(12.9, 77.6, 15), p(12.9, 77.6, 30), p(12.9, 77.6, 45)],
    });
    expect(kinds(sigs)).toContain('REPEAT_COORD');
  });
  it('does not flag three identical points', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.9, 77.6, 15), p(12.9, 77.6, 30)] });
    expect(kinds(sigs)).not.toContain('REPEAT_COORD');
  });
});

describe('frozen position', () => {
  it('flags no movement at all over > 2 min', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.9, 77.6, 130)] });
    expect(kinds(sigs)).toContain('FROZEN');
  });
  it('does not flag a short identical pair', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0), p(12.9, 77.6, 20)] });
    expect(kinds(sigs)).not.toContain('FROZEN');
  });
});

describe('round accuracy', () => {
  it('isRoundAccuracy only for exact multiples of 5', () => {
    expect(isRoundAccuracy(10)).toBe(true);
    expect(isRoundAccuracy(5)).toBe(true);
    expect(isRoundAccuracy(12)).toBe(false);
    expect(isRoundAccuracy(13.7)).toBe(false);
  });
  it('flags 4+ exact-round accuracy readings', () => {
    const sigs = evaluateSpoof({
      prev: null,
      points: [p(12.9, 77.6, 0, 10), p(12.901, 77.6, 15, 10), p(12.902, 77.6, 30, 10), p(12.903, 77.6, 45, 10)],
    });
    expect(kinds(sigs)).toContain('ROUND_ACCURACY');
  });
});

describe('device-clock skew', () => {
  it('flags drift beyond 2 minutes', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0)], driftMs: 5 * 60_000 });
    expect(kinds(sigs)).toContain('CLOCK_SKEW');
  });
  it('tolerates small latency drift', () => {
    const sigs = evaluateSpoof({ prev: null, points: [p(12.9, 77.6, 0)], driftMs: 8_000 });
    expect(kinds(sigs)).not.toContain('CLOCK_SKEW');
  });
});

describe('honest movement', () => {
  it('raises nothing for a normal city ride', () => {
    // ~40 km/h: ~170 m every 15 s.
    const pts = [p(12.900, 77.600, 0), p(12.9015, 77.600, 15), p(12.9030, 77.600, 30), p(12.9045, 77.600, 45)];
    const sigs = evaluateSpoof({ prev: null, points: pts, driftMs: 500 });
    expect(sigs).toEqual([]);
  });
  it('empty input raises nothing', () => {
    expect(evaluateSpoof({ prev: null, points: [] })).toEqual([]);
  });
});

it('TELEPORT_DIST_M is the documented 2 km', () => {
  expect(TELEPORT_DIST_M).toBe(2000);
});
