/**
 * Operating-hours resolver — answers "is this branch open right now?" and
 * "when does it next open?" given the 7-day OperatingHours rows from Prisma.
 *
 * Data model (see prisma/schema.prisma `OperatingHours`):
 *   one row per (branchId, dayOfWeek 0..6) storing openMin and closeMin
 *   measured in minutes-from-midnight (0..1440).
 *
 * Conventions
 * - openMin == closeMin == 0          → that day is CLOSED
 * - closeMin > openMin (normal)        → window is [openMin, closeMin) on that day
 * - closeMin <= openMin (overnight)    → window extends into next day, i.e.
 *                                         [openMin, 1440) on day D PLUS
 *                                         [0, closeMin) on day D+1
 *   This is how late-night kitchens (e.g. 18:00 → 02:00) are expressed.
 * - If a branch has zero rows at all  → treated as ALWAYS OPEN (legacy default).
 *
 * Day-of-week mapping
 *   We use the JavaScript convention `Date.getDay()` (0 = Sunday, 6 = Saturday),
 *   which matches what the admin UI saves.
 *
 * Timezone
 *   Hours are IST wall-clock. Open/closed is computed in IST explicitly
 *   (src/lib/ist-time.ts), independent of the server or browser timezone.
 */

import { istClock, istDayAt } from '@/lib/ist-time';

export interface OperatingHoursRow {
  dayOfWeek: number;
  openMin: number;
  closeMin: number;
}

export interface BranchOpenStatus {
  /** True if the branch is currently inside an operating window. */
  isOpen: boolean;
  /**
   * The next moment the branch transitions state.
   * - If open: when it will close
   * - If closed: when it will next open
   * - null if there are no rows at all (always-open legacy) or every day is closed.
   */
  nextChangeAt: Date | null;
  /** Human label, e.g. "Closed — opens Monday 11:00 AM" or "Open until 11:00 PM". */
  label: string;
  /** Reason describing why closed, useful for diagnostics. */
  reason: 'open' | 'no-hours-set' | 'closed-today' | 'before-open' | 'after-close';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function dayHasOpenWindow(h: OperatingHoursRow): boolean {
  // A day is "closed" iff openMin === closeMin === 0.
  // Any other combination (including closeMin <= openMin) is a real window.
  return !(h.openMin === 0 && h.closeMin === 0);
}

function isOvernight(h: OperatingHoursRow): boolean {
  // 18:00 → 02:00 means closeMin (120) <= openMin (1080) AND closeMin > 0.
  // A row with openMin = closeMin > 0 is degenerate; we treat as a normal window.
  return dayHasOpenWindow(h) && h.closeMin < h.openMin;
}

/**
 * The instant at IST minute M, `dayOffset` IST days after `now`'s IST date.
 */
function makeDateForDayOffset(now: Date, dayOffset: number, minute: number): Date {
  return istDayAt(now, dayOffset, minute);
}

/**
 * Get a normalized lookup: day-of-week → row.
 * Missing rows are treated as closed (consistent with how the admin form
 * pre-fills missing days with `closed: true`).
 */
function indexByDay(rows: OperatingHoursRow[]): Map<number, OperatingHoursRow> {
  const m = new Map<number, OperatingHoursRow>();
  for (const r of rows) m.set(r.dayOfWeek, r);
  return m;
}

/**
 * Core: is the branch open at `now`?
 *
 * Algorithm (handles overnight windows):
 *   1. Look at today's row. If it's a normal window, check `openMin <= curMin < closeMin`.
 *   2. If today's row is overnight, check `curMin >= openMin` (still tonight).
 *   3. Also check YESTERDAY's row — if yesterday was overnight, it might still
 *      be running, i.e. `curMin < yesterday.closeMin`.
 */
export function isBranchOpenAt(rows: OperatingHoursRow[], now: Date): BranchOpenStatus {
  // Legacy / no setup → always open.
  if (!rows || rows.length === 0) {
    return { isOpen: true, nextChangeAt: null, label: 'Open', reason: 'open' };
  }

  const { dayOfWeek: today, minutes: curMin } = istClock(now);
  const yesterday = (today + 6) % 7;

  const byDay = indexByDay(rows);
  const todayRow = byDay.get(today);
  const yesterdayRow = byDay.get(yesterday);

  // (A) Did yesterday's overnight window spill into today?
  if (yesterdayRow && isOvernight(yesterdayRow) && curMin < yesterdayRow.closeMin) {
    return {
      isOpen: true,
      nextChangeAt: makeDateForDayOffset(now, 0, yesterdayRow.closeMin),
      label: `Open until ${fmtTime(yesterdayRow.closeMin)}`,
      reason: 'open',
    };
  }

  // (B) Is today an open day, and are we inside its window?
  if (todayRow && dayHasOpenWindow(todayRow)) {
    if (isOvernight(todayRow)) {
      // Overnight: e.g. open 18:00, close 02:00 tomorrow.
      if (curMin >= todayRow.openMin) {
        return {
          isOpen: true,
          nextChangeAt: makeDateForDayOffset(now, 1, todayRow.closeMin),
          label: `Open until ${fmtTime(todayRow.closeMin)} tomorrow`,
          reason: 'open',
        };
      }
      // Otherwise we're before the evening open time today.
    } else {
      // Normal same-day window.
      if (curMin >= todayRow.openMin && curMin < todayRow.closeMin) {
        return {
          isOpen: true,
          nextChangeAt: makeDateForDayOffset(now, 0, todayRow.closeMin),
          label: `Open until ${fmtTime(todayRow.closeMin)}`,
          reason: 'open',
        };
      }
    }
  }

  // (C) We are CLOSED. Find the next open moment, searching forward up to 7 days.
  for (let offset = 0; offset < 8; offset++) {
    const dow = (today + offset) % 7;
    const row = byDay.get(dow);
    if (!row || !dayHasOpenWindow(row)) continue;

    // Skip today if we've already passed today's open time.
    if (offset === 0) {
      if (curMin >= row.openMin) continue;
    }

    const nextOpen = makeDateForDayOffset(now, offset, row.openMin);
    const dayLabel =
      offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_NAMES[dow];
    const reason: BranchOpenStatus['reason'] =
      offset === 0 ? 'before-open' : todayRow && dayHasOpenWindow(todayRow) ? 'after-close' : 'closed-today';
    return {
      isOpen: false,
      nextChangeAt: nextOpen,
      label: `Closed — opens ${dayLabel} at ${fmtTime(row.openMin)}`,
      reason,
    };
  }

  // Every day closed → permanently closed.
  return {
    isOpen: false,
    nextChangeAt: null,
    label: 'Closed',
    reason: 'no-hours-set',
  };
}

/**
 * Validate that a scheduled order time falls inside an open window.
 * Returns the matching close-time as a sanity-check anchor, or null if invalid.
 */
export function isScheduledTimeInsideOpenWindow(
  rows: OperatingHoursRow[],
  scheduledAt: Date,
): boolean {
  const status = isBranchOpenAt(rows, scheduledAt);
  return status.isOpen;
}
