import { prisma } from '@/server/db';

const DEFAULT_DAILY = 20;

export class YoupiCapExceededError extends Error {
  constructor(message = 'YouPI daily transaction cap reached') {
    super(message);
    this.name = 'YoupiCapExceededError';
  }
}

export class YoupiAmountExceededError extends Error {
  constructor(message = 'YouPI max transaction amount exceeded') {
    super(message);
    this.name = 'YoupiAmountExceededError';
  }
}

/** Today at UTC midnight (matches the @db.Date column). */
export function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/**
 * Checks max amount, then atomically reserves one slot for today.
 * The conditional updateMany (WHERE count < limit) is the single-winner guard:
 * concurrent calls can never push the count past the limit.
 * Slots are not released on downstream failure (conservative for the pilot).
 */
export async function assertUnderCap(
  restaurantId: string,
  amountPaise: number,
  cfg: { dailyLimit?: number; maxAmountPaise?: number },
): Promise<void> {
  const dailyLimit = cfg.dailyLimit ?? DEFAULT_DAILY;
  if (cfg.maxAmountPaise !== undefined && amountPaise > cfg.maxAmountPaise) {
    throw new YoupiAmountExceededError();
  }
  const day = todayUtc();
  await prisma.youpiDailyUsage.upsert({
    where: { restaurantId_day: { restaurantId, day } },
    create: { restaurantId, day, count: 0 },
    update: {},
  });
  const res = await prisma.youpiDailyUsage.updateMany({
    where: { restaurantId, day, count: { lt: dailyLimit } },
    data: { count: { increment: 1 } },
  });
  if (res.count === 0) throw new YoupiCapExceededError();
}
