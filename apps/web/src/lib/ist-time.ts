/**
 * India Standard Time helpers. Every restaurant schedule in Flavrly (operating hours, category
 * windows, happy hours, offer windows) is entered as IST wall-clock minutes, so it must be evaluated
 * in IST no matter what timezone the server process (or browser) runs in. IST is a fixed UTC+05:30
 * with no daylight saving, so a constant offset is exact.
 */
export const IST_OFFSET_MINUTES = 330;
const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** IST weekday (0 = Sunday … 6 = Saturday) and minutes since IST midnight for an instant. */
export function istClock(at: Date): { dayOfWeek: number; minutes: number } {
  const s = new Date(at.getTime() + OFFSET_MS);
  return { dayOfWeek: s.getUTCDay(), minutes: s.getUTCHours() * 60 + s.getUTCMinutes() };
}

/** The instant at `minute` minutes past IST midnight, `dayOffset` IST days after `at`'s IST date. */
export function istDayAt(at: Date, dayOffset: number, minute: number): Date {
  const s = new Date(at.getTime() + OFFSET_MS);
  const midnightUtcOfIstDate = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + dayOffset);
  return new Date(midnightUtcOfIstDate - OFFSET_MS + minute * 60_000);
}
