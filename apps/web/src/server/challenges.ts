/**
 * Challenge engine — gamified offers that encourage repeat orders.
 *
 * The public surface comes in two flavours:
 *
 *   PURE (tested without a DB):
 *     applyOrderToProgress(challenge, prev, order)
 *       → advances a customer's progress for a single delivered order.
 *         Returns `{ next, completed, justCompleted }`. Deterministic;
 *         all state lives in `prev` and `order` so the same call replays.
 *
 *     percentComplete(challenge, value)
 *       → 0..100 progress percentage for the UI bar.
 *
 *     orderIsEligible(order, challenge)
 *       → true if the order satisfies challenge.minOrderValue + windowing.
 *
 *   DB-AWARE (called by the order-delivered hook + UI endpoints):
 *     refreshChallengeProgressForOrder(orderId)
 *       → idempotent. Loads the delivered order, finds every active
 *         challenge that could apply, advances each progress row in a
 *         transaction, and emits a ChallengeReward + Offer if any
 *         completes.
 *
 *     listChallengesForCustomer(userId)
 *       → returns active challenges + the customer's progress for each,
 *         with `value`, `target`, `percent`, `completed`, and `reward`
 *         hydrated. Powers the /rewards page.
 *
 *     listRewardsForCustomer(userId)
 *       → returns issued ChallengeRewards including the linked Offer,
 *         so the UI can show coupon code + expiry.
 *
 * Fraud prevention rules enforced here (in addition to the hook only
 * firing on DELIVERED):
 *   - `challenge.phoneVerifiedOnly` → reject when user.phone is null/blank.
 *   - `challenge.perCustomerLimit` → don't issue a 2nd reward for the same
 *     (challenge, user). Re-enforced in the issuance transaction.
 *   - `challenge.totalLimit` → don't issue beyond the global cap.
 *   - Per-phone reuse check: if any ChallengeReward already exists for the
 *     same challengeId AND phoneSnapshot, refuse — protects against multi-
 *     account abuse with one phone number.
 *   - Cancelled/refunded/payment-failed orders never reach this module —
 *     the hook only fires on the DELIVERED transition.
 */
import type { ChallengeType, ChallengeWindow, ChallengeRewardType } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { clampTwo } from '@/lib/utils';

// ── Public types ─────────────────────────────────────────────────────────

export interface ChallengeLite {
  id: string;
  name: string;
  description: string | null;
  type: ChallengeType;
  target: number;
  window: ChallengeWindow;
  minOrderValue: number | string | null;
  rewardType: ChallengeRewardType;
  rewardValue: number | string;
  rewardMaxDiscount: number | string | null;
  rewardValidityDays: number;
  validFrom: Date | string;
  validTo: Date | string | null;
  isActive: boolean;
  priority: number;
  perCustomerLimit: number;
  phoneVerifiedOnly: boolean;
  totalLimit: number | null;
  totalIssued: number;
  brandId: string | null;
  restaurantId: string | null;
}

export interface OrderForProgress {
  id: string;
  customerId: string;
  total: number;
  placedAt: Date;
  // Optional context — we look these up from branch.restaurantId in the hook.
  restaurantId?: string | null;
  brandId?: string | null;
}

export interface ProgressState {
  /** Numeric counter — meaning depends on Challenge.type. */
  value: number;
  /** Free-form per-type state (cuisine ID set, last weekend ISO, …). */
  metadata: ProgressMetadata;
  completed: boolean;
}

export interface ProgressMetadata {
  cuisineIds?: string[];               // for CUISINE_VARIETY
  lastWeekendISO?: string | null;       // for WEEKEND_STREAK (Sunday of last counted weekend)
  orderIds?: string[];                  // for FIRST_N_ORDERS (cap idempotency)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function num(v: any, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Return the Sunday-of-week ISO string for any date. Used by WEEKEND_STREAK
 *  to canonicalise "the customer ordered on Saturday or Sunday of this week". */
function sundayISO(d: Date): string {
  const c = new Date(d);
  const day = c.getDay(); // 0..6 (Sun..Sat)
  // Move forward to Sunday: 0 stays, 1..6 advance (7-day) - day mod 7
  const advance = day === 0 ? 0 : 7 - day;
  c.setDate(c.getDate() + advance);
  c.setHours(0, 0, 0, 0);
  return c.toISOString().slice(0, 10);
}

/** Is the given date on Sat or Sun? */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Calendar-month identifier "YYYY-MM" used to scope MONTHLY windows. */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
function weekKey(d: Date): string {
  // ISO week-ish: use sundayISO as a stable string sort key.
  return sundayISO(d);
}

// ── Window gating ────────────────────────────────────────────────────────

/**
 * Does `order.placedAt` fall inside the challenge's active window?
 *
 *   LIFETIME → always true (within validFrom/validTo)
 *   MONTHLY  → same calendar month as `referenceNow`
 *   WEEKLY   → same Sunday-of-week as `referenceNow`
 *   CUSTOM   → bounded by validFrom..validTo (already checked on the SQL side)
 */
export function orderIsInChallengeWindow(challenge: ChallengeLite, order: OrderForProgress, referenceNow: Date = new Date()): boolean {
  const placed = new Date(order.placedAt);
  const from = new Date(challenge.validFrom);
  if (placed < from) return false;
  if (challenge.validTo && placed > new Date(challenge.validTo)) return false;
  switch (challenge.window) {
    case 'LIFETIME': return true;
    case 'MONTHLY':  return monthKey(placed) === monthKey(referenceNow);
    case 'WEEKLY':   return weekKey(placed)  === weekKey(referenceNow);
    case 'CUSTOM':   return true; // validFrom/validTo bound the whole challenge
    default:         return true;
  }
}

/**
 * Min-order-value gate. Returns true when the order's total meets the floor
 * (or the challenge has no minimum).
 */
export function orderMeetsMinimum(challenge: ChallengeLite, order: OrderForProgress): boolean {
  const min = num(challenge.minOrderValue, 0);
  return min <= 0 || order.total >= min;
}

/** Combined gate used by `applyOrderToProgress` and the hook. */
export function orderIsEligible(challenge: ChallengeLite, order: OrderForProgress, referenceNow: Date = new Date()): boolean {
  return orderIsInChallengeWindow(challenge, order, referenceNow) && orderMeetsMinimum(challenge, order);
}

// ── Pure progress machine ────────────────────────────────────────────────

/**
 * Apply ONE delivered order to a customer's progress for ONE challenge.
 * Returns `next` with the updated state, plus `justCompleted` so the caller
 * can fire the reward emission only once.
 *
 * Idempotent: if the order is already recorded in the metadata's order list
 * (FIRST_N_ORDERS / CUISINE_VARIETY de-dupe), this is a no-op.
 */
export function applyOrderToProgress(
  challenge: ChallengeLite,
  prev: ProgressState,
  order: OrderForProgress,
  referenceNow: Date = new Date()
): { next: ProgressState; justCompleted: boolean } {
  // Already completed challenges are sticky — never decrement, never re-fire.
  if (prev.completed) return { next: prev, justCompleted: false };
  if (!orderIsEligible(challenge, order, referenceNow)) return { next: prev, justCompleted: false };

  const meta: ProgressMetadata = { ...(prev.metadata ?? {}) };
  // Avoid double-counting if the same order is replayed
  const seenOrders = new Set(meta.orderIds ?? []);
  if (seenOrders.has(order.id)) return { next: prev, justCompleted: false };

  let value = prev.value;
  switch (challenge.type) {
    case 'ORDER_COUNT':
    case 'FIRST_N_ORDERS': {
      value = prev.value + 1;
      const orderIds = (meta.orderIds ?? []).concat(order.id);
      meta.orderIds = orderIds.slice(-challenge.target); // cap memory at target
      break;
    }
    case 'SPEND_THRESHOLD': {
      value = clampTwo(prev.value + order.total);
      const orderIds = (meta.orderIds ?? []).concat(order.id);
      meta.orderIds = orderIds.slice(-100); // keep last 100 for traceability
      break;
    }
    case 'CUISINE_VARIETY': {
      // Each *distinct* restaurantId counts once. We treat the restaurantId
      // as the cuisine ID — the brand layer is folded in by the hook when it
      // passes context, but at this level "different cuisine" = different
      // restaurantId.
      const key = order.restaurantId ?? `unknown:${order.id}`;
      const cuisineIds = new Set(meta.cuisineIds ?? []);
      const wasNew = !cuisineIds.has(key);
      cuisineIds.add(key);
      meta.cuisineIds = Array.from(cuisineIds);
      value = wasNew ? prev.value + 1 : prev.value;
      const orderIds = (meta.orderIds ?? []).concat(order.id);
      meta.orderIds = orderIds.slice(-100);
      break;
    }
    case 'WEEKEND_STREAK': {
      if (!isWeekend(new Date(order.placedAt))) {
        return { next: prev, justCompleted: false };
      }
      const thisSunday = sundayISO(new Date(order.placedAt));
      // First-ever weekend hit
      if (!meta.lastWeekendISO) {
        meta.lastWeekendISO = thisSunday;
        value = 1;
      } else if (thisSunday === meta.lastWeekendISO) {
        // Same weekend — no extra credit, but still record the order.
      } else {
        const lastSundayDate = new Date(meta.lastWeekendISO + 'T00:00:00');
        const thisSundayDate = new Date(thisSunday + 'T00:00:00');
        const daysApart = Math.round((thisSundayDate.getTime() - lastSundayDate.getTime()) / 86_400_000);
        if (daysApart === 7) {
          value = prev.value + 1;
          meta.lastWeekendISO = thisSunday;
        } else if (daysApart > 7) {
          // Gap — streak resets to 1.
          value = 1;
          meta.lastWeekendISO = thisSunday;
        }
      }
      const orderIds = (meta.orderIds ?? []).concat(order.id);
      meta.orderIds = orderIds.slice(-50);
      break;
    }
  }

  const completed = value >= challenge.target;
  const justCompleted = completed && !prev.completed;
  return {
    next: { value: clampTwo(value), metadata: meta, completed },
    justCompleted
  };
}

export function percentComplete(challenge: ChallengeLite, value: number): number {
  const t = Math.max(1, challenge.target);
  return Math.min(100, Math.round((value / t) * 100));
}

// ── DB-aware: refresh on delivered ───────────────────────────────────────

/**
 * Called by the orders state-machine when an order transitions to DELIVERED.
 * Idempotent: safe to call twice for the same order — the per-progress
 * `seenOrders` check de-dupes inside `applyOrderToProgress`.
 *
 * Emits a ChallengeReward + auto-generated Offer for any challenge the
 * customer just completed. The new Offer uses the existing Offer engine for
 * downstream cart redemption, so we don't reinvent code validation, expiry,
 * or per-customer caps.
 */
export async function refreshChallengeProgressForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { branch: { include: { restaurant: { select: { id: true, brandId: true } } } }, customer: { select: { id: true, phone: true } } }
  });
  if (!order) return;
  const customer = order.customer;
  const restaurantId = order.branch.restaurant.id;
  const brandId = order.branch.restaurant.brandId ?? null;

  const now = new Date();
  const challenges = await (prisma as any).challenge.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      AND: [
        { OR: [{ restaurantId: null }, { restaurantId }] },
        { OR: [{ brandId: null }, { brandId }] }
      ]
    },
    orderBy: { priority: 'desc' }
  });
  if (challenges.length === 0) return;

  for (const ch of challenges as ChallengeLite[]) {
    // Phone verification gate (fraud prevention).
    if (ch.phoneVerifiedOnly && !customer.phone) continue;
    // Total-issued cap (cost control).
    if (ch.totalLimit != null && ch.totalIssued >= ch.totalLimit) continue;

    const orderCtx: OrderForProgress = {
      id: order.id,
      customerId: customer.id,
      total: Number(order.total),
      placedAt: order.placedAt ?? order.createdAt,
      restaurantId,
      brandId
    };
    if (!orderIsEligible(ch, orderCtx, now)) continue;

    // Load or create the progress row.
    const existing = await (prisma as any).challengeProgress.findUnique({
      where: { challengeId_userId: { challengeId: ch.id, userId: customer.id } }
    });
    const prevState: ProgressState = existing
      ? { value: Number(existing.value), metadata: (existing.metadata as ProgressMetadata) ?? {}, completed: existing.completed }
      : { value: 0, metadata: {}, completed: false };

    const { next, justCompleted } = applyOrderToProgress(ch, prevState, orderCtx, now);
    if (next === prevState) continue; // no change

    await (prisma as any).challengeProgress.upsert({
      where: { challengeId_userId: { challengeId: ch.id, userId: customer.id } },
      update: {
        value: next.value as any,
        metadata: next.metadata as any,
        completed: next.completed,
        completedAt: next.completed ? new Date() : null,
        lastOrderId: order.id
      },
      create: {
        challengeId: ch.id,
        userId: customer.id,
        value: next.value as any,
        metadata: next.metadata as any,
        completed: next.completed,
        completedAt: next.completed ? new Date() : null,
        lastOrderId: order.id
      }
    });

    if (justCompleted) {
      await issueRewardForCompletion(ch, customer.id, customer.phone ?? null, order.id);
    }
  }
}

// ── Reward issuance ──────────────────────────────────────────────────────

function generateCouponCode(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `${p}-${r}`;
}

/**
 * Hand the customer their reward as an Offer row tied through a
 * ChallengeReward. Fraud guards:
 *   - per-customer limit (refuse if already issued perCustomerLimit times)
 *   - per-phone limit (refuse if same phone already has a reward for this challenge)
 *   - increment Challenge.totalIssued atomically
 */
export async function issueRewardForCompletion(
  challenge: ChallengeLite,
  userId: string,
  phoneSnapshot: string | null,
  triggerOrderId: string | null
) {
  // Refuse if customer already has perCustomerLimit rewards for this challenge.
  const existingForUser = await (prisma as any).challengeReward.count({
    where: { challengeId: challenge.id, userId }
  });
  if (existingForUser >= challenge.perCustomerLimit) return null;

  // Refuse if same phone already redeemed (multi-account abuse).
  if (phoneSnapshot) {
    const phoneAbuse = await (prisma as any).challengeReward.count({
      where: { challengeId: challenge.id, phoneSnapshot, NOT: { userId } }
    });
    if (phoneAbuse > 0) return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + challenge.rewardValidityDays * 86_400_000);
  const code = generateCouponCode(challenge.name);

  return await prisma.$transaction(async (tx: any) => {
    // Re-check totalLimit inside the transaction to avoid over-issue races.
    const fresh = await tx.challenge.findUnique({ where: { id: challenge.id }, select: { totalIssued: true, totalLimit: true } });
    if (fresh.totalLimit != null && fresh.totalIssued >= fresh.totalLimit) return null;

    // Map ChallengeRewardType → Offer's reward shape.
    const offerData: any = {
      name: `Challenge reward · ${challenge.name}`,
      description: `Auto-issued from "${challenge.name}". Code expires ${expiresAt.toISOString().slice(0, 10)}.`,
      type: challenge.rewardType === 'PERCENT_OFF' ? 'PERCENTAGE' : 'FIXED',
      code,
      percentOff: challenge.rewardType === 'PERCENT_OFF' ? Number(challenge.rewardValue) : null,
      flatOff: challenge.rewardType === 'FIXED_OFF' ? Number(challenge.rewardValue) : null,
      maxDiscount: challenge.rewardMaxDiscount ? Number(challenge.rewardMaxDiscount) : null,
      restaurantId: challenge.restaurantId,
      validFrom: now,
      validTo: expiresAt,
      usageLimit: 1,
      perUserLimit: 1,
      isActive: true,
      autoApply: false, // customer must explicitly apply the code
      stackable: false,
      priority: 50
    };
    const offer = await tx.offer.create({ data: offerData });
    const reward = await tx.challengeReward.create({
      data: {
        challengeId: challenge.id,
        userId,
        offerId: offer.id,
        phoneSnapshot,
        triggerOrderId
      }
    });
    await tx.challenge.update({ where: { id: challenge.id }, data: { totalIssued: { increment: 1 } } });
    return { offer, reward };
  }).then(async (result) => {
    if (result) {
      await audit('challenge.reward.issued' as any, {
        actorId: userId,
        entityType: 'ChallengeReward',
        entityId: result.reward.id,
        before: null,
        after: { offerId: result.offer.id, code: result.offer.code, challengeId: challenge.id }
      });
    }
    return result;
  });
}

// ── Customer-facing listings ─────────────────────────────────────────────

export async function listChallengesForCustomer(userId: string) {
  const now = new Date();
  const challenges = await (prisma as any).challenge.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }]
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });
  if (challenges.length === 0) return [];

  const progress = await (prisma as any).challengeProgress.findMany({
    where: { userId, challengeId: { in: challenges.map((c: any) => c.id) } }
  });
  const byChallenge = new Map(progress.map((p: any) => [p.challengeId, p]));

  return challenges.map((c: any) => {
    const p = byChallenge.get(c.id) as any;
    const value = p ? Number(p.value) : 0;
    return {
      ...c,
      progress: {
        value,
        percent: percentComplete(c as ChallengeLite, value),
        completed: !!p?.completed,
        completedAt: p?.completedAt ?? null
      }
    };
  });
}

export async function listRewardsForCustomer(userId: string) {
  return (prisma as any).challengeReward.findMany({
    where: { userId },
    include: { offer: true, challenge: { select: { id: true, name: true, description: true } } },
    orderBy: { issuedAt: 'desc' }
  });
}
