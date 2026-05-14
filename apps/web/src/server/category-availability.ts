/**
 * Category availability resolver.
 *
 * Shared by:
 *   - Customer menu (filters / dims unavailable categories)
 *   - Admin menu manager (status badge: Available now / Off-hours / Disabled)
 *   - Kitchen panel (kitchen still sees the category but tagged as off-hours)
 *   - Cart-add API (server-side guard to reject items from off-hours categories)
 *
 * Design mirrors the existing MenuItemAvailability semantics:
 *   - 0 = Sunday … 6 = Saturday (JS Date.getDay)
 *   - startMin inclusive, endMin exclusive, both in local wall-clock minutes
 *   - A category with `scheduleEnabled = false` is always available when active
 *
 * Pure functions only — no DB access here. Callers pre-load the
 * CategoryAvailability rows alongside Category and pass them in. This keeps
 * the helper easy to unit-test and lets the SSR page batch its DB calls.
 */

export interface ScheduleRow {
  dayOfWeek: number; // 0..6
  startMin: number;  // 0..1440, inclusive
  endMin: number;    // 0..1440, exclusive
}

export interface CategoryLite {
  id: string;
  name?: string;
  isActive: boolean;
  scheduleEnabled: boolean;
  availabilities: ScheduleRow[];
}

export type AvailabilityReason =
  | 'available'
  | 'disabled'            // admin flipped isActive=false
  | 'no_schedule_rows'    // scheduleEnabled but zero rows configured
  | 'off_hours';          // scheduleEnabled, has rows, but `now` is outside all of them

export interface AvailabilityResult {
  available: boolean;
  reason: AvailabilityReason;
  /** Minutes from `now` until the next window opens. `null` if disabled or no rows. */
  minutesUntilOpen: number | null;
  /** The next window that will open. `null` if disabled or no rows. */
  nextOpensAt: { dayOfWeek: number; startMin: number; endMin: number } | null;
}

const ONE_DAY_MIN = 24 * 60;

/**
 * Resolve whether `category` is orderable at `now`.
 *
 * `now` is injected so tests can pin the clock; callers in app code pass
 * `new Date()`.
 */
export function isCategoryAvailableNow(category: CategoryLite, now: Date = new Date()): AvailabilityResult {
  if (!category.isActive) {
    return { available: false, reason: 'disabled', minutesUntilOpen: null, nextOpensAt: null };
  }
  if (!category.scheduleEnabled) {
    // No schedule = always-on (matches MenuItem semantics)
    return { available: true, reason: 'available', minutesUntilOpen: 0, nextOpensAt: null };
  }
  if (!category.availabilities || category.availabilities.length === 0) {
    return { available: false, reason: 'no_schedule_rows', minutesUntilOpen: null, nextOpensAt: null };
  }

  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  // Is `now` inside any window today?
  for (const row of category.availabilities) {
    if (row.dayOfWeek === day && mins >= row.startMin && mins < row.endMin) {
      return { available: true, reason: 'available', minutesUntilOpen: 0, nextOpensAt: row };
    }
  }

  // Off-hours: find the next window in the next 7 days. Normalising "minutes
  // from now until the start of (day, startMin)" works by walking days 0..6
  // ahead of today, so a Tuesday-only window seen on Friday returns +4 days.
  let bestMinutes = Infinity;
  let bestRow: ScheduleRow | null = null;
  for (let offset = 0; offset < 7; offset++) {
    const futureDay = (day + offset) % 7;
    for (const row of category.availabilities) {
      if (row.dayOfWeek !== futureDay) continue;
      const dayDelta = offset * ONE_DAY_MIN;
      const startInWeek = row.startMin + dayDelta;
      // Today's rows that have already finished should jump to next week (offset=0 but startMin<=now means already passed)
      if (offset === 0 && row.startMin <= mins) continue;
      const deltaMin = startInWeek - mins;
      if (deltaMin > 0 && deltaMin < bestMinutes) {
        bestMinutes = deltaMin;
        bestRow = row;
      }
    }
  }
  return {
    available: false,
    reason: 'off_hours',
    minutesUntilOpen: bestRow ? bestMinutes : null,
    nextOpensAt: bestRow ?? null
  };
}

/** Sugar over the resolver — returns just the boolean. */
export function categoryOpenNow(category: CategoryLite, now: Date = new Date()): boolean {
  return isCategoryAvailableNow(category, now).available;
}

/**
 * Format the `nextOpensAt` row as a short customer-facing label.
 *
 *   "Opens at 18:00 today"          → today, later
 *   "Opens at 07:00 tomorrow"       → tomorrow
 *   "Opens at 11:00 on Saturday"    → 2-7 days away
 */
export function formatNextOpenLabel(result: AvailabilityResult, now: Date = new Date()): string | null {
  if (!result.nextOpensAt || result.minutesUntilOpen == null) return null;
  const today = now.getDay();
  const target = result.nextOpensAt.dayOfWeek;
  const dayDelta = (target - today + 7) % 7;
  const hh = String(Math.floor(result.nextOpensAt.startMin / 60)).padStart(2, '0');
  const mm = String(result.nextOpensAt.startMin % 60).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (dayDelta === 0) return `Opens at ${time} today`;
  if (dayDelta === 1) return `Opens at ${time} tomorrow`;
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return `Opens at ${time} on ${names[target]}`;
}

/**
 * Convenience for the menu list. Partition categories into orderable now vs.
 * not, in the same pass — used by the customer page to render two sections
 * (visible up top, "Coming up later" muted further down).
 */
export function partitionByAvailability<T extends CategoryLite>(
  cats: T[],
  now: Date = new Date()
): { orderable: T[]; offHours: T[]; disabled: T[]; results: Map<string, AvailabilityResult> } {
  const orderable: T[] = [];
  const offHours: T[] = [];
  const disabled: T[] = [];
  const results = new Map<string, AvailabilityResult>();
  for (const c of cats) {
    const r = isCategoryAvailableNow(c, now);
    results.set(c.id, r);
    if (r.available) orderable.push(c);
    else if (r.reason === 'disabled') disabled.push(c);
    else offHours.push(c);
  }
  return { orderable, offHours, disabled, results };
}
