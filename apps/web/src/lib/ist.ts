/**
 * India Standard Time helpers (UTC+05:30, no DST).
 *
 * Restaurants operate on IST, but the server may run in UTC (or anything else).
 * `Date#setHours` / `toISOString().slice(0, 10)` / `toLocaleString()` without a
 * timeZone all use the SERVER's zone or UTC, which shifts day buckets by 5h30
 * (an order at 00:30 IST lands on the previous day). Use these instead for
 * every restaurant-facing day boundary, day key, hour bucket and timestamp.
 *
 * Self-contained and dependency-free so both server and client code can use it.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The IST calendar day of `d` as `YYYY-MM-DD`. */
export function istDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's IST day key. */
export function istTodayKey(now: Date = new Date()): string {
  return istDayKey(now);
}

/** Shift a `YYYY-MM-DD` key by `days` (negative = earlier). */
export function addDaysToKey(key: string, days: number): string {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** The instant of 00:00:00.000 IST on the given day (a key, or the IST day containing a Date). */
export function istStartOfDay(day: string | Date = new Date()): Date {
  const key = typeof day === 'string' ? day : istDayKey(day);
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_OFFSET_MS);
}

/** The instant of 23:59:59.999 IST on the given day. */
export function istEndOfDay(day: string | Date = new Date()): Date {
  return new Date(istStartOfDay(day).getTime() + DAY_MS - 1);
}

/** The IST hour-of-day (0–23) of `d`. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** The last `days` IST day keys, oldest first, ending today. */
export function lastIstDayKeys(days: number, now: Date = new Date()): string[] {
  const today = istDayKey(now);
  return Array.from({ length: days }, (_, i) => addDaysToKey(today, -(days - 1 - i)));
}

/** True for a strict `YYYY-MM-DD` key. */
export function isDayKey(s: string): boolean {
  return KEY_RE.test(s);
}

/** Human timestamp in IST, e.g. "25 Oct 2026, 9:05 pm". */
export function formatIst(d: Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: IST_TIME_ZONE }).format(d);
}
