/**
 * Shared helpers for the rider Earnings & Payments feature bundle.
 *
 * Everything money-related that more than one route needs lives here so the
 * payout / incentive / surge / COD handlers stay thin. Prisma `Decimal`s are
 * always normalised to plain `number`s before they leave this module.
 */
import { prisma } from './db';

/**
 * A rider's withdrawable balance: lifetime earnings minus everything that has
 * already been paid out or is in flight. FAILED payouts are excluded — that
 * money never left, so it's still available.
 */
export async function computeAvailableBalance(riderProfileId: string): Promise<number> {
  const profile = await prisma.riderProfile.findUnique({
    where: { id: riderProfileId },
    select: { totalEarnings: true },
  });
  if (!profile) return 0;

  const drawn = await prisma.riderPayout.aggregate({
    where: { riderId: riderProfileId, status: { not: 'FAILED' } },
    _sum: { amount: true },
  });

  const lifetime = Number(profile.totalEarnings);
  const paidOrPending = Number(drawn._sum.amount ?? 0);
  // Never report a negative balance — clamp at zero.
  return Math.max(0, Math.round((lifetime - paidOrPending) * 100) / 100);
}

/** Local calendar-day key, e.g. "2026-05-14". */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * ISO-8601 week key, e.g. "2026-W20". Week starts Monday; the week-number
 * algorithm is the standard "Thursday of the current week" approach.
 */
export function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // Sun → 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // shift to Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${`${week}`.padStart(2, '0')}`;
}

/** Start of the local calendar day for the given date. */
export function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Start of the local ISO week (Monday 00:00) for the given date. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dayNum = s.getDay() || 7; // Sun → 7
  s.setDate(s.getDate() - (dayNum - 1));
  return s;
}

/**
 * Count a rider's DELIVERED assignments delivered on/after `since`. Used to
 * compute live incentive progress for the current day / week.
 */
export async function countDeliveriesSince(riderProfileId: string, since: Date): Promise<number> {
  return prisma.riderAssignment.count({
    where: {
      riderId: riderProfileId,
      status: 'DELIVERED',
      deliveredAt: { gte: since },
    },
  });
}
