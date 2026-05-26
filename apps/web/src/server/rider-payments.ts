/**
 * Shared helpers for the rider Earnings & Payments feature bundle.
 *
 * Everything money-related that more than one route needs lives here so the
 * payout / incentive / surge / COD handlers stay thin. Prisma `Decimal`s are
 * always normalised to plain `number`s before they leave this module.
 */
import { prisma } from './db';
import { audit } from './audit';

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

export interface IncentiveOutcome {
  incentiveId: string;
  title: string;
  periodKey: string;
  deliveriesDone: number;
  targetDeliveries: number;
  achieved: boolean;
  /** Bonus credited to the rider on THIS call (0 if already paid or not yet achieved). */
  bonusCredited: number;
}

/**
 * Advance a rider's incentive progress after a delivery and pay out any newly
 * achieved slabs.
 *
 * For every currently-active RiderIncentive, we recompute the rider's delivery
 * count for the relevant period (DAILY → today, WEEKLY → this ISO week) from the
 * source of truth (DELIVERED assignments) rather than blindly incrementing, so
 * the progress is self-correcting and safe to call more than once. When the
 * count reaches the target and the slab hasn't been paid yet, we mark it
 * achieved and credit the flat bonus to the rider's lifetime earnings — guarded
 * by `bonusPaid` inside a transaction so a bonus can never be paid twice even
 * under concurrent deliveries.
 *
 * Best-effort: never throws into the delivery path. Returns what happened for
 * logging / UI.
 */
export async function applyIncentivesForDelivery(riderProfileId: string, now = new Date()): Promise<IncentiveOutcome[]> {
  try {
    const active = await prisma.riderIncentive.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    });
    if (active.length === 0) return [];

    const outcomes: IncentiveOutcome[] = [];

    for (const inc of active) {
      const periodStart = inc.period === 'WEEKLY' ? startOfWeek(now) : startOfDay(now);
      const periodKey = inc.period === 'WEEKLY' ? weekKey(now) : dayKey(now);
      const deliveriesDone = await countDeliveriesSince(riderProfileId, periodStart);
      const target = inc.targetDeliveries;
      const nowAchieved = deliveriesDone >= target;
      const bonus = Number(inc.bonusAmount);

      // Upsert progress with the recomputed count. Mark achieved if the bar is
      // cleared (achievedAt only stamped on the first transition).
      const progress = await prisma.riderIncentiveProgress.upsert({
        where: { incentiveId_riderId_periodKey: { incentiveId: inc.id, riderId: riderProfileId, periodKey } },
        create: {
          incentiveId: inc.id,
          riderId: riderProfileId,
          periodKey,
          deliveriesDone,
          achieved: nowAchieved,
          achievedAt: nowAchieved ? now : null,
        },
        update: {
          deliveriesDone,
          achieved: nowAchieved ? true : undefined,
          achievedAt: nowAchieved ? now : undefined,
        },
      });

      let bonusCredited = 0;
      if (nowAchieved && !progress.bonusPaid && bonus > 0) {
        // Atomically claim the payout: only the writer that flips bonusPaid
        // false→true (count === 1) credits the rider. Concurrent calls see 0.
        const claimed = await prisma.$transaction(async (tx) => {
          const res = await tx.riderIncentiveProgress.updateMany({
            where: { id: progress.id, bonusPaid: false },
            data: { bonusPaid: true },
          });
          if (res.count !== 1) return false;
          await tx.riderProfile.update({
            where: { id: riderProfileId },
            data: { totalEarnings: { increment: bonus as any } },
          });
          return true;
        });
        if (claimed) {
          bonusCredited = bonus;
          await audit('rider.incentive.bonus', {
            actorRole: 'SYSTEM',
            entityType: 'RiderIncentiveProgress',
            entityId: progress.id,
            after: { riderId: riderProfileId, incentiveId: inc.id, periodKey, bonus, deliveriesDone, target },
          });
        }
      }

      outcomes.push({
        incentiveId: inc.id,
        title: inc.title,
        periodKey,
        deliveriesDone,
        targetDeliveries: target,
        achieved: nowAchieved,
        bonusCredited,
      });
    }

    return outcomes;
  } catch {
    // Incentives must never break delivery confirmation.
    return [];
  }
}
