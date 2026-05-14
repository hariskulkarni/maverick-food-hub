/**
 * Post-delivery feedback resolver — pure helpers + DB-aware wrappers.
 *
 * The 48-hour rule lives in one place. Every API endpoint reads through these
 * helpers so the customer flow, admin views, rider views, and reports all
 * agree on what "eligible", "editable", and "read-only" mean.
 *
 * Public surface:
 *
 *   FEEDBACK_WINDOW_HOURS                 — the spec's 48-hour edit window
 *   canSubmitFeedback(order, existing, now)
 *                                         — true if customer can create one now
 *   canEditFeedback(feedback, now)        — true within window AND author-owned
 *   isFeedbackReadOnly(feedback, now)     — true past window — for the UI
 *   visibleForRole(feedback, role, opts)  — applies redaction so the rider
 *                                           never sees private comments unless
 *                                           the customer opted in
 *   summariseRatings(feedbackRows)        — averages + counts for reports
 *
 *   loadCustomerFeedback / loadRestaurantFeedback / loadRiderFeedback /
 *   loadFeedbackReport                    — DB-aware bundles used by /api and
 *                                           the dashboard pages.
 *
 * Conventions:
 *   - Star ratings are integers 1..5; `null` means "customer skipped this axis"
 *   - `windowEndsAt` is snapshotted on create so clock-drift on `placedAt`
 *     can't reset the window for an old order
 *   - `issueTags` is a Postgres-native array, returned verbatim
 */
import { prisma } from './db';
import type { FeedbackIssueTag } from '@prisma/client';

// ── Constants ────────────────────────────────────────────────────────────

export const FEEDBACK_WINDOW_HOURS = 48;
export const FEEDBACK_WINDOW_MS = FEEDBACK_WINDOW_HOURS * 60 * 60 * 1000;

// ── Public types ─────────────────────────────────────────────────────────

export interface OrderLite {
  id: string;
  customerId: string;
  status: string;
  // Used to compute window. We prefer the rider-assignment.deliveredAt if
  // present (most accurate), else the order's own updatedAt-at-DELIVERED.
  deliveredAt: Date | null;
}

export interface FeedbackLite {
  id: string;
  orderId: string;
  customerId: string;
  foodRating: number | null;
  deliveryRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: FeedbackIssueTag[];
  imageUrl: string | null;
  shareCommentWithRider: boolean;
  windowEndsAt: Date | string;
  createdAt: Date | string;
  editedAt: Date | string | null;
}

export type FeedbackEligibility =
  | { eligible: true; reason?: undefined }
  | { eligible: false; reason: 'not_delivered' | 'window_expired' | 'already_submitted' | 'not_owner' };

// ── Pure: eligibility + window math ──────────────────────────────────────

export function deliveredAtFromOrder(order: OrderLite): Date | null {
  return order.deliveredAt;
}

export function windowEndForOrder(order: OrderLite): Date | null {
  const d = deliveredAtFromOrder(order);
  return d ? new Date(d.getTime() + FEEDBACK_WINDOW_MS) : null;
}

/**
 * Can the customer SUBMIT feedback for this order right now?
 * Returns a discriminated union so the UI can render the right empty-state copy.
 */
export function canSubmitFeedback(
  order: OrderLite,
  existing: FeedbackLite | null,
  callerUserId: string,
  now: Date = new Date()
): FeedbackEligibility {
  if (order.customerId !== callerUserId) return { eligible: false, reason: 'not_owner' };
  if (order.status !== 'DELIVERED') return { eligible: false, reason: 'not_delivered' };
  if (existing) return { eligible: false, reason: 'already_submitted' };
  const winEnd = windowEndForOrder(order);
  if (!winEnd) return { eligible: false, reason: 'not_delivered' };
  if (now > winEnd) return { eligible: false, reason: 'window_expired' };
  return { eligible: true };
}

/**
 * Can the customer EDIT existing feedback?
 * Tighter than `canSubmitFeedback`: must own the row AND be inside the window.
 */
export function canEditFeedback(feedback: FeedbackLite | null, callerUserId: string, now: Date = new Date()): FeedbackEligibility {
  if (!feedback) return { eligible: false, reason: 'already_submitted' };
  if (feedback.customerId !== callerUserId) return { eligible: false, reason: 'not_owner' };
  const winEnd = new Date(feedback.windowEndsAt);
  if (now > winEnd) return { eligible: false, reason: 'window_expired' };
  return { eligible: true };
}

/**
 * UI sugar — same as `canEditFeedback` but inverted. Lets the React component
 * easily render "edit" vs "view-only" without re-implementing the math.
 */
export function isFeedbackReadOnly(feedback: FeedbackLite, now: Date = new Date()): boolean {
  return now > new Date(feedback.windowEndsAt);
}

// ── Role-based redaction ─────────────────────────────────────────────────

export type ViewerRole = 'CUSTOMER' | 'RIDER' | 'ADMIN' | 'SUPER_ADMIN' | 'KITCHEN';

export interface RedactedFeedback {
  id: string;
  orderId: string;
  foodRating: number | null;
  deliveryRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: FeedbackIssueTag[];
  imageUrl: string | null;
  createdAt: Date | string;
  editedAt: Date | string | null;
  /** When the viewing role is not allowed to see a field, it's omitted (not nulled)
   *  so the UI can render "—" without ambiguity. */
  visibleFields: ('food' | 'delivery' | 'overall' | 'comment' | 'tags' | 'image')[];
}

/**
 * Project a FeedbackLite through the visibility rules. Centralises the policy
 * so it can never drift between an API endpoint and a UI page.
 *
 *   CUSTOMER     — full view of own feedback (the only time they see it)
 *   SUPER_ADMIN  — full view
 *   ADMIN        — food rating + food-related tags + comment + image; delivery
 *                  rating is omitted (the rider/super-admin own that side)
 *   RIDER        — delivery rating only; comment is shown only when the
 *                  customer set `shareCommentWithRider = true`. Image hidden
 *                  unless food/packaging issue tags are absent (so rider proof
 *                  doesn't leak food-quality photos).
 *   KITCHEN      — food rating + food-related tags, no comment, no image
 */
export function visibleForRole(feedback: FeedbackLite, role: ViewerRole): RedactedFeedback {
  // Tag families to gate per-role exposure.
  const FOOD_TAGS: FeedbackIssueTag[] = ['MISSING_ITEM' as any, 'WRONG_ITEM' as any, 'COLD_FOOD' as any, 'PACKAGING_ISSUE' as any, 'FOOD_QUALITY' as any];
  const DELIVERY_TAGS: FeedbackIssueTag[] = ['LATE_DELIVERY' as any, 'RIDER_BEHAVIOR' as any];

  switch (role) {
    case 'CUSTOMER':
    case 'SUPER_ADMIN':
      return {
        id: feedback.id, orderId: feedback.orderId,
        foodRating: feedback.foodRating,
        deliveryRating: feedback.deliveryRating,
        overallRating: feedback.overallRating,
        comment: feedback.comment,
        issueTags: feedback.issueTags,
        imageUrl: feedback.imageUrl,
        createdAt: feedback.createdAt, editedAt: feedback.editedAt,
        visibleFields: ['food', 'delivery', 'overall', 'comment', 'tags', 'image']
      };

    case 'ADMIN':
      return {
        id: feedback.id, orderId: feedback.orderId,
        foodRating: feedback.foodRating,
        deliveryRating: null,
        overallRating: feedback.overallRating,
        comment: feedback.comment,
        issueTags: feedback.issueTags.filter((t) => FOOD_TAGS.includes(t)),
        imageUrl: feedback.imageUrl,
        createdAt: feedback.createdAt, editedAt: feedback.editedAt,
        visibleFields: ['food', 'overall', 'comment', 'tags', 'image']
      };

    case 'KITCHEN':
      return {
        id: feedback.id, orderId: feedback.orderId,
        foodRating: feedback.foodRating,
        deliveryRating: null,
        overallRating: null,
        comment: null,
        issueTags: feedback.issueTags.filter((t) => FOOD_TAGS.includes(t)),
        imageUrl: null,
        createdAt: feedback.createdAt, editedAt: feedback.editedAt,
        visibleFields: ['food', 'tags']
      };

    case 'RIDER': {
      const showImage = feedback.issueTags.filter((t) => FOOD_TAGS.includes(t)).length === 0;
      return {
        id: feedback.id, orderId: feedback.orderId,
        foodRating: null,
        deliveryRating: feedback.deliveryRating,
        overallRating: null,
        comment: feedback.shareCommentWithRider ? feedback.comment : null,
        issueTags: feedback.issueTags.filter((t) => DELIVERY_TAGS.includes(t)),
        imageUrl: showImage ? feedback.imageUrl : null,
        createdAt: feedback.createdAt, editedAt: feedback.editedAt,
        visibleFields: ['delivery', 'tags', ...(feedback.shareCommentWithRider ? (['comment'] as any) : []), ...(showImage ? (['image'] as any) : [])]
      };
    }
  }
}

// ── Reports / summary math ───────────────────────────────────────────────

export interface RatingSummary {
  count: number;
  avgFood: number | null;
  avgDelivery: number | null;
  avgOverall: number | null;
  lowFoodCount: number;        // foodRating ≤ 2
  lowDeliveryCount: number;
  lowOverallCount: number;
  tagCounts: Record<string, number>;
}

/** Reduce a set of feedback rows into a single rating summary. Pure — no DB. */
export function summariseRatings(rows: FeedbackLite[]): RatingSummary {
  let food = 0, foodN = 0, del = 0, delN = 0, over = 0, overN = 0;
  let lowFood = 0, lowDel = 0, lowOver = 0;
  const tagCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.foodRating != null) { food += r.foodRating; foodN++; if (r.foodRating <= 2) lowFood++; }
    if (r.deliveryRating != null) { del += r.deliveryRating; delN++; if (r.deliveryRating <= 2) lowDel++; }
    if (r.overallRating != null) { over += r.overallRating; overN++; if (r.overallRating <= 2) lowOver++; }
    for (const t of r.issueTags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  const avg = (sum: number, n: number) => (n === 0 ? null : Math.round((sum / n) * 10) / 10);
  return {
    count: rows.length,
    avgFood: avg(food, foodN),
    avgDelivery: avg(del, delN),
    avgOverall: avg(over, overN),
    lowFoodCount: lowFood,
    lowDeliveryCount: lowDel,
    lowOverallCount: lowOver,
    tagCounts
  };
}

// ── DB-aware loaders ─────────────────────────────────────────────────────

export async function findFeedbackByOrder(orderId: string): Promise<FeedbackLite | null> {
  const row = await (prisma as any).orderFeedback.findUnique({ where: { orderId } });
  return row ?? null;
}

/** For the customer order-history view — which of their delivered orders are
 *  still inside the feedback window? */
export async function pendingFeedbackOrdersForCustomer(customerId: string, now: Date = new Date()) {
  const windowStart = new Date(now.getTime() - FEEDBACK_WINDOW_MS);
  const orders = await prisma.order.findMany({
    where: {
      customerId,
      status: 'DELIVERED',
      updatedAt: { gte: windowStart },
      feedback: null
    },
    select: { id: true, code: true, updatedAt: true }
  });
  return orders.map((o) => ({
    orderId: o.id,
    orderCode: o.code,
    windowEndsAt: new Date((o.updatedAt as Date).getTime() + FEEDBACK_WINDOW_MS)
  }));
}

/** Restaurant-level feedback rollup for /admin/feedback. */
export async function loadRestaurantFeedback(restaurantId: string, opts: { from?: Date; to?: Date; lowOnly?: boolean } = {}) {
  const rows = await (prisma as any).orderFeedback.findMany({
    where: {
      order: { branch: { restaurantId } },
      ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
      ...(opts.lowOnly ? { OR: [{ foodRating: { lte: 2 } }, { deliveryRating: { lte: 2 } }, { overallRating: { lte: 2 } }] } : {})
    },
    include: { order: { select: { code: true, total: true, branchId: true, assignment: { select: { riderId: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return { rows, summary: summariseRatings(rows) };
}

/** Rider-side rollup — only the delivery rating + their own deliveries. */
export async function loadRiderFeedback(riderId: string) {
  const rows = await (prisma as any).orderFeedback.findMany({
    where: { order: { assignment: { riderId } } },
    include: { order: { select: { code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return {
    rows: rows.map((r: any) => visibleForRole(r, 'RIDER')),
    summary: summariseRatings(rows)
  };
}
