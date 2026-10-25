/**
 * India Standard Time helpers (UTC+5:30, no DST).
 *
 * Rider pay rules (lunch/dinner peak, late night, weekend), "today" / "this
 * week" earnings and incentive periods are all defined in IST. The server can
 * run in any TZ (the VPS is UTC), so never use Date#getHours/getDay/setHours
 * for these — use the helpers below, which are TZ-independent.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Wall-clock parts of `d` in IST. */
export function istParts(d: Date): { year: number; month: number; day: number; minutesOfDay: number; dayOfWeek: number } {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    minutesOfDay: s.getUTCHours() * 60 + s.getUTCMinutes(),
    dayOfWeek: s.getUTCDay(), // 0 = Sunday
  };
}

/** The instant of IST midnight that starts the IST calendar day containing `d`. */
export function istStartOfDay(d: Date): Date {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  s.setUTCHours(0, 0, 0, 0);
  return new Date(s.getTime() - IST_OFFSET_MS);
}

/** The instant of Monday 00:00 IST that starts the ISO week containing `d`. */
export function istStartOfWeek(d: Date): Date {
  const start = istStartOfDay(d);
  const dow = istParts(d).dayOfWeek || 7; // Sun → 7
  return new Date(start.getTime() - (dow - 1) * 24 * 60 * 60 * 1000);
}

/** IST calendar-day key, e.g. "2026-05-14". */
export function istDayKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
