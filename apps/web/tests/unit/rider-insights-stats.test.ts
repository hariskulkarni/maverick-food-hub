/** Online / idle time math for rider insights (server/rider-insights/stats.ts). */
import { describe, it, expect } from 'vitest';
import { idleMs, onlineIntervals, overlapMs, totalMs, unionIntervals, windowStats, type StatusEventLite } from '@/server/rider-insights/stats';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 27, 0, 0, 0);
const ev = (type: StatusEventLite['type'], h: number): StatusEventLite => ({ type, at: new Date(T0 + h * H) });

describe('onlineIntervals', () => {
  it('pairs ONLINE with OFFLINE / AUTO_OFFLINE and keeps signal events online', () => {
    const events = [ev('ONLINE', 1), ev('SIGNAL_LOST', 2), ev('SIGNAL_REGAINED', 2.5), ev('OFFLINE', 3), ev('ONLINE', 5), ev('AUTO_OFFLINE', 6)];
    const iv = onlineIntervals(events, T0, T0 + 24 * H, T0 + 24 * H, null);
    expect(iv).toEqual([[T0 + 1 * H, T0 + 3 * H], [T0 + 5 * H, T0 + 6 * H]]);
    expect(totalMs(iv)).toBe(3 * H);
  });

  it('uses the state before the window and closes an open interval at openUntil', () => {
    // Online since yesterday, still online, now = 10:00.
    const iv = onlineIntervals([], T0, T0 + 24 * H, T0 + 10 * H, 'ONLINE');
    expect(iv).toEqual([[T0, T0 + 10 * H]]);
  });

  it('assumes offline with no history (never invents online time)', () => {
    expect(onlineIntervals([ev('OFFLINE', 4)], T0, T0 + 24 * H, T0 + 24 * H, null)).toEqual([]);
  });

  it('ignores a duplicate ONLINE (no double counting)', () => {
    const iv = onlineIntervals([ev('ONLINE', 1), ev('ONLINE', 2), ev('OFFLINE', 3)], T0, T0 + 24 * H, T0 + 24 * H, null);
    expect(totalMs(iv)).toBe(2 * H);
  });
});

describe('interval helpers', () => {
  it('union merges overlaps and overlap/idle subtract delivery time', () => {
    expect(unionIntervals([[5, 10], [1, 3], [2, 6]])).toEqual([[1, 10]]);
    const online: [number, number][] = [[0, 100], [200, 300]];
    const deliveries: [number, number][] = [[50, 120], [250, 260], [90, 110]];
    expect(overlapMs(online, deliveries)).toBe(50 + 10);
    expect(idleMs(online, deliveries)).toBe(200 - 60);
  });
});

describe('windowStats', () => {
  it('computes online, idle, deliveries, distance, speed and signal incidents for a window', () => {
    const now = T0 + 12 * H;
    const north = (m: number) => 16.3 + m / 111_195;
    // 6 km ride from 09:00 to 09:20 (18 km/h) — 1 point per 60 s, 300 m apart.
    const pings = Array.from({ length: 21 }, (_, i) => ({ lat: north(i * 300), lng: 80.4, t: T0 + 9 * H + i * 60_000 }));
    const s = windowStats({
      start: T0,
      end: now,
      openUntil: now,
      stateBefore: null,
      eventsAsc: [ev('ONLINE', 8), ev('SIGNAL_LOST', 9.1), ev('SIGNAL_REGAINED', 9.2), ev('AUTO_OFFLINE', 11), ev('ONLINE', 11.5)],
      deliveries: [
        { start: T0 + 9 * H, end: T0 + 9.5 * H, deliveredAt: T0 + 9.5 * H },
        { start: T0 + 11.75 * H, end: now, deliveredAt: null }, // in progress
        { start: T0 + 7 * H, end: null, deliveredAt: null }, // cancelled
      ],
      pings,
    });
    expect(s.onlineMs).toBe(3 * H + 0.5 * H); // 08–11 and 11:30–12
    expect(s.idleMs).toBe(3.5 * H - 0.5 * H - 0.25 * H);
    expect(s.deliveries).toBe(1);
    expect(s.distanceM).toBeGreaterThan(5980);
    expect(s.distanceM).toBeLessThan(6020);
    expect(s.avgSpeedKph).toBeCloseTo(18, 0);
    expect(s.signalLost).toBe(1);
    expect(s.autoOffline).toBe(1);
  });

  it('derives the starting state from events before the window', () => {
    const s = windowStats({
      start: T0 + 10 * H,
      end: T0 + 12 * H,
      openUntil: T0 + 12 * H,
      stateBefore: null,
      eventsAsc: [ev('ONLINE', 8)],
      deliveries: [],
      pings: [],
    });
    expect(s.onlineMs).toBe(2 * H);
    expect(s.idleMs).toBe(2 * H);
  });
});
