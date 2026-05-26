import { describe, it, expect } from 'vitest';
import { shiftStartMs } from '@/server/jobs/rider-shift-missed-sweep';

/**
 * RiderShift.date is a @db.Date → Prisma hands it back at UTC midnight of that
 * calendar day. startTime is "HH:MM" wall-clock in IST (UTC+5:30). The sweep
 * must reconstruct the absolute UTC instant of the shift start so it can decide
 * whether the start (+grace) has passed. These tests pin that math.
 */
describe('shiftStartMs', () => {
  const dateUtcMidnight = new Date(Date.UTC(2026, 4, 26)); // 2026-05-26 00:00 UTC

  it('maps 09:00 IST to 03:30 UTC on the same date', () => {
    const ms = shiftStartMs(dateUtcMidnight, '09:00');
    expect(ms).not.toBeNull();
    expect(new Date(ms!).toISOString()).toBe('2026-05-26T03:30:00.000Z');
  });

  it('maps 00:00 IST to the previous UTC day 18:30', () => {
    const ms = shiftStartMs(dateUtcMidnight, '00:00');
    expect(new Date(ms!).toISOString()).toBe('2026-05-25T18:30:00.000Z');
  });

  it('maps 23:30 IST to 18:00 UTC the same date', () => {
    const ms = shiftStartMs(dateUtcMidnight, '23:30');
    expect(new Date(ms!).toISOString()).toBe('2026-05-26T18:00:00.000Z');
  });

  it('accepts single-digit hours', () => {
    const ms = shiftStartMs(dateUtcMidnight, '9:05');
    expect(new Date(ms!).toISOString()).toBe('2026-05-26T03:35:00.000Z');
  });

  it('rejects malformed times', () => {
    expect(shiftStartMs(dateUtcMidnight, '')).toBeNull();
    expect(shiftStartMs(dateUtcMidnight, 'morning')).toBeNull();
    expect(shiftStartMs(dateUtcMidnight, '25:00')).toBeNull();
    expect(shiftStartMs(dateUtcMidnight, '10:75')).toBeNull();
  });
});
