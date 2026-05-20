/**
 * Unit tests for the reservation double-booking overlap detector.
 *
 * `reservationsOverlap(aStart, aDurMin, bStart, bDurMin)` is the pure heart of
 * the table-availability engine — both findAvailableTables and the
 * createReservation commit-time re-check rely on it. Windows are half-open
 * [start, start+duration), so back-to-back bookings (one ends exactly when the
 * next begins) must NOT collide.
 */
import { describe, it, expect } from 'vitest';
import { reservationsOverlap } from '@/server/reservations';

// Anchor: 2026-06-01 19:00 IST-naive (ms since epoch, local). Use a fixed base
// so the arithmetic is obvious.
const base = new Date('2026-06-01T19:00:00').getTime();
const MIN = 60_000;

describe('reservationsOverlap', () => {
  it('detects a fully-overlapping window (same slot, same duration)', () => {
    expect(reservationsOverlap(base, 90, base, 90)).toBe(true);
  });

  it('detects partial overlap (B starts midway through A)', () => {
    // A: 19:00–20:30, B: 20:00–21:30 → overlap 20:00–20:30
    expect(reservationsOverlap(base, 90, base + 60 * MIN, 90)).toBe(true);
  });

  it('detects partial overlap regardless of argument order (symmetric)', () => {
    const a = reservationsOverlap(base, 90, base + 60 * MIN, 90);
    const b = reservationsOverlap(base + 60 * MIN, 90, base, 90);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });

  it('does NOT collide for back-to-back bookings (A ends exactly as B starts)', () => {
    // A: 19:00–20:30, B: 20:30–22:00 → boundary touch, half-open ⇒ no overlap
    expect(reservationsOverlap(base, 90, base + 90 * MIN, 90)).toBe(false);
  });

  it('does NOT collide for clearly separate windows', () => {
    // A: 19:00–20:30, B: 21:00–22:30 → 30-min gap
    expect(reservationsOverlap(base, 90, base + 120 * MIN, 90)).toBe(false);
  });

  it('detects a short window fully contained inside a long one', () => {
    // A: 19:00–22:00 (180m), B: 20:00–20:30 (30m) → B inside A
    expect(reservationsOverlap(base, 180, base + 60 * MIN, 30)).toBe(true);
  });

  it('detects overlap when the existing booking starts BEFORE the new one', () => {
    // existing: 18:30–20:00, new: 19:00–20:30 → overlap 19:00–20:00
    expect(reservationsOverlap(base, 90, base - 30 * MIN, 90)).toBe(true);
  });

  it('1-minute overlap still counts as a collision', () => {
    // A: 19:00–20:30, B: 20:29–21:59 → 1-min overlap
    expect(reservationsOverlap(base, 90, base + 89 * MIN, 90)).toBe(true);
  });

  it('treats a 0-minute gap on the other side as no overlap too', () => {
    // B ends exactly when A starts: B 17:30–19:00, A 19:00–20:30
    expect(reservationsOverlap(base, 90, base - 90 * MIN, 90)).toBe(false);
  });
});
