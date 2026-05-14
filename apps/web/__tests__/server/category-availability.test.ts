/**
 * Unit tests for the category availability resolver.
 *
 * All cases pin a deterministic `now` so the day/hour math is easy to verify.
 * Day-of-week reference (matches JS Date.getDay):
 *   0 = Sun · 1 = Mon · 2 = Tue · 3 = Wed · 4 = Thu · 5 = Fri · 6 = Sat
 */
import { describe, it, expect } from 'vitest';
import {
  isCategoryAvailableNow,
  categoryOpenNow,
  formatNextOpenLabel,
  partitionByAvailability,
  type CategoryLite
} from '@/server/category-availability';

const wed_10am = new Date('2026-05-13T10:00:00'); // Wednesday 10:00
const wed_12pm = new Date('2026-05-13T12:00:00'); // Wednesday 12:00
const wed_8am  = new Date('2026-05-13T08:00:00'); // Wednesday 08:00
const fri_3pm  = new Date('2026-05-15T15:00:00'); // Friday    15:00
const sat_2pm  = new Date('2026-05-16T14:00:00'); // Saturday  14:00

function cat(partial: Partial<CategoryLite>): CategoryLite {
  return {
    id: 'cat-1',
    name: 'Test',
    isActive: true,
    scheduleEnabled: false,
    availabilities: [],
    ...partial
  };
}

describe('isCategoryAvailableNow', () => {
  it('isActive=false → disabled regardless of schedule', () => {
    const r = isCategoryAvailableNow(cat({ isActive: false, scheduleEnabled: true, availabilities: [{ dayOfWeek: 3, startMin: 0, endMin: 1440 }] }), wed_10am);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('scheduleEnabled=false → always available when active (back-compat with old categories)', () => {
    const r = isCategoryAvailableNow(cat({ scheduleEnabled: false }), wed_10am);
    expect(r.available).toBe(true);
    expect(r.reason).toBe('available');
  });

  it('scheduleEnabled with no rows → unavailable + no next-open', () => {
    const r = isCategoryAvailableNow(cat({ scheduleEnabled: true, availabilities: [] }), wed_10am);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('no_schedule_rows');
    expect(r.nextOpensAt).toBeNull();
  });

  it('inside today\'s window → available', () => {
    const breakfast = cat({
      scheduleEnabled: true,
      availabilities: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 7 * 60, endMin: 11 * 60 }))
    });
    const r = isCategoryAvailableNow(breakfast, wed_8am);
    expect(r.available).toBe(true);
    expect(r.minutesUntilOpen).toBe(0);
  });

  it('outside today\'s window → off-hours with minutesUntilOpen', () => {
    const lunch = cat({
      scheduleEnabled: true,
      availabilities: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 12 * 60, endMin: 15 * 60 }))
    });
    const r = isCategoryAvailableNow(lunch, wed_10am);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('off_hours');
    // From 10:00 to 12:00 = 120 minutes
    expect(r.minutesUntilOpen).toBe(120);
    expect(r.nextOpensAt).toMatchObject({ dayOfWeek: 3, startMin: 720, endMin: 900 });
  });

  it('startMin is inclusive, endMin is exclusive', () => {
    const lunch = cat({
      scheduleEnabled: true,
      availabilities: [{ dayOfWeek: 3, startMin: 12 * 60, endMin: 15 * 60 }]
    });
    // At exactly 12:00 → in
    expect(isCategoryAvailableNow(lunch, wed_12pm).available).toBe(true);
    // At exactly 15:00 → out (window is [12, 15))
    expect(isCategoryAvailableNow(lunch, new Date('2026-05-13T15:00:00')).available).toBe(false);
  });

  it('weekend-only schedule is unavailable on weekdays', () => {
    const weekendSpecials = cat({
      scheduleEnabled: true,
      availabilities: [
        { dayOfWeek: 0, startMin: 11 * 60, endMin: 22 * 60 },
        { dayOfWeek: 6, startMin: 11 * 60, endMin: 22 * 60 }
      ]
    });
    // Friday 15:00 → next open is Saturday 11:00 = 20 hours away
    const r = isCategoryAvailableNow(weekendSpecials, fri_3pm);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('off_hours');
    expect(r.nextOpensAt?.dayOfWeek).toBe(6);
    expect(r.minutesUntilOpen).toBe(20 * 60);
  });

  it('weekend-only schedule is available on Saturday afternoon', () => {
    const weekendSpecials = cat({
      scheduleEnabled: true,
      availabilities: [
        { dayOfWeek: 0, startMin: 11 * 60, endMin: 22 * 60 },
        { dayOfWeek: 6, startMin: 11 * 60, endMin: 22 * 60 }
      ]
    });
    expect(categoryOpenNow(weekendSpecials, sat_2pm)).toBe(true);
  });

  it('after the last window of the day → rolls to tomorrow', () => {
    const dinner = cat({
      scheduleEnabled: true,
      availabilities: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 18 * 60, endMin: 23 * 60 }))
    });
    // Wednesday 23:30 — past today's dinner window → next is Thursday 18:00
    const r = isCategoryAvailableNow(dinner, new Date('2026-05-13T23:30:00'));
    expect(r.available).toBe(false);
    // From Wed 23:30 → Thu 18:00 = 18*60 + 30 = 1110 mins
    expect(r.minutesUntilOpen).toBe(18 * 60 + 30);
    expect(r.nextOpensAt?.dayOfWeek).toBe(4);
  });

  it('handles a window that ended earlier today by picking next day', () => {
    const breakfast = cat({
      scheduleEnabled: true,
      availabilities: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 7 * 60, endMin: 11 * 60 }))
    });
    // Wed 12:00 — breakfast already ended → next is Thu 07:00
    const r = isCategoryAvailableNow(breakfast, wed_12pm);
    expect(r.available).toBe(false);
    expect(r.nextOpensAt?.dayOfWeek).toBe(4);
    // 12:00 → 07:00 next day = (24*60 - 12*60) + 7*60 = 720 + 420 = 1140
    expect(r.minutesUntilOpen).toBe(19 * 60);
  });
});

describe('formatNextOpenLabel', () => {
  it('returns null when nothing to format', () => {
    const r = isCategoryAvailableNow(cat({ scheduleEnabled: false }), wed_10am);
    expect(formatNextOpenLabel(r)).toBeNull();
  });

  it('"today" when same day, later', () => {
    const lunch = cat({
      scheduleEnabled: true,
      availabilities: [{ dayOfWeek: 3, startMin: 12 * 60, endMin: 15 * 60 }]
    });
    const r = isCategoryAvailableNow(lunch, wed_10am);
    expect(formatNextOpenLabel(r, wed_10am)).toBe('Opens at 12:00 today');
  });

  it('"tomorrow" when next day', () => {
    const breakfast = cat({
      scheduleEnabled: true,
      availabilities: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMin: 7 * 60, endMin: 11 * 60 }))
    });
    const r = isCategoryAvailableNow(breakfast, wed_12pm);
    expect(formatNextOpenLabel(r, wed_12pm)).toBe('Opens at 07:00 tomorrow');
  });

  it('day name when 2+ days out', () => {
    const weekendSpecials = cat({
      scheduleEnabled: true,
      availabilities: [
        { dayOfWeek: 0, startMin: 11 * 60, endMin: 22 * 60 },
        { dayOfWeek: 6, startMin: 11 * 60, endMin: 22 * 60 }
      ]
    });
    // Wednesday → Saturday is 3 days away
    const r = isCategoryAvailableNow(weekendSpecials, wed_10am);
    expect(formatNextOpenLabel(r, wed_10am)).toBe('Opens at 11:00 on Saturday');
  });
});

describe('partitionByAvailability', () => {
  it('sorts categories into orderable / off-hours / disabled', () => {
    const cats: CategoryLite[] = [
      cat({ id: 'always',  scheduleEnabled: false }),
      cat({ id: 'disabled',isActive: false }),
      cat({
        id: 'lunch',
        scheduleEnabled: true,
        availabilities: [{ dayOfWeek: 3, startMin: 12 * 60, endMin: 15 * 60 }]
      }),
      cat({
        id: 'breakfast',
        scheduleEnabled: true,
        availabilities: [{ dayOfWeek: 3, startMin: 7 * 60, endMin: 11 * 60 }]
      })
    ];
    const { orderable, offHours, disabled, results } = partitionByAvailability(cats, wed_10am);
    // At Wed 10:00 breakfast (07:00–11:00) is still inside its window; lunch is not.
    expect(orderable.map((c) => c.id).sort()).toEqual(['always', 'breakfast']);
    expect(offHours.map((c) => c.id)).toEqual(['lunch']);
    expect(disabled.map((c) => c.id)).toEqual(['disabled']);
    expect(results.size).toBe(4);
  });
});
