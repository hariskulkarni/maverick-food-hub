/**
 * Review ↔ order matching (admin-only context).
 *
 * Google gives us only the reviewer's public display name and the review time.
 * We fuzzy-match that name against customers of THIS restaurant whose order was
 * delivered in the 72 hours before the review. The best candidate is stored as
 * a suggestion with a confidence; it is shown to the restaurant admin and fed
 * to the AI draft as private context. Order details never go into public reply
 * text (the reply safety filter receives the order's identifiers as blocked
 * terms).
 */
import { prisma } from '@/server/db';

export const MATCH_WINDOW_HOURS = 72;
export const MIN_CONFIDENCE = 0.6;

function norm(s: string | null | undefined): string[] {
  return (s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ')
    .split(/\s+/).filter((t) => t.length > 0);
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a); const B = bigrams(b);
  const counts = new Map<string, number>();
  A.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  let hit = 0;
  for (const x of B) {
    const c = counts.get(x) ?? 0;
    if (c > 0) { hit++; counts.set(x, c - 1); }
  }
  return (2 * hit) / (A.length + B.length);
}

/**
 * Name similarity 0..1. Full-name equality = 1; first names equal + last-name
 * initial compatible = 0.9; first names equal alone = 0.75; otherwise fuzzy.
 */
export function nameSimilarity(reviewer: string | null | undefined, customer: string | null | undefined): number {
  const a = norm(reviewer); const b = norm(customer);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  if (a[0] === b[0]) {
    if (a.length > 1 && b.length > 1) return a[a.length - 1][0] === b[b.length - 1][0] ? 0.9 : 0.6;
    return 0.75;
  }
  return Math.round(dice(a.join(' '), b.join(' ')) * 0.8 * 100) / 100;
}

/** Confidence = name similarity, discounted up to 20% as the delivery gets older within the window. */
export function matchConfidence(nameSim: number, hoursBeforeReview: number): number {
  const age = Math.min(1, Math.max(0, hoursBeforeReview / MATCH_WINDOW_HOURS));
  return Math.round(nameSim * (1 - 0.2 * age) * 100) / 100;
}

export type MatchResult = { orderId: string; confidence: number } | null;

export async function findOrderMatch(
  restaurantId: string, review: { reviewerName: string | null; reviewCreatedAt: Date },
): Promise<MatchResult> {
  if (!review.reviewerName?.trim()) return null;
  const to = review.reviewCreatedAt;
  const from = new Date(to.getTime() - MATCH_WINDOW_HOURS * 3_600_000);
  const orders = await prisma.order.findMany({
    where: { branch: { restaurantId }, status: 'DELIVERED', deliveredAt: { gte: from, lte: to } },
    select: { id: true, deliveredAt: true, customer: { select: { name: true } } },
    take: 500,
  });
  let best: MatchResult = null;
  for (const o of orders) {
    const sim = nameSimilarity(review.reviewerName, o.customer?.name);
    if (sim <= 0) continue;
    const hours = (to.getTime() - (o.deliveredAt ?? to).getTime()) / 3_600_000;
    const conf = matchConfidence(sim, hours);
    if (conf >= MIN_CONFIDENCE && (!best || conf > best.confidence)) best = { orderId: o.id, confidence: conf };
  }
  return best;
}

/** Find + store the best match (or record that we looked). */
export async function matchAndStore(
  restaurantId: string, review: { id: string; reviewerName: string | null; reviewCreatedAt: Date },
): Promise<MatchResult> {
  const m = await findOrderMatch(restaurantId, review);
  await prisma.googleReview.updateMany({
    where: { id: review.id, restaurantId },
    data: { matchedOrderId: m?.orderId ?? null, matchConfidence: m?.confidence ?? null, matchCheckedAt: new Date() },
  });
  return m;
}

export type OrderContext = {
  orderId: string; code: string; confidence: number | null;
  items: Array<{ name: string; quantity: number }>;
  deliveredAt: string | null; promisedAt: string | null; lateByMin: number | null;
  riderName: string | null;
  /** Identifiers that must never appear in a public reply. */
  privateTerms: string[];
};

/** Order context for the admin (tenant-scoped: the order must belong to this restaurant). */
export async function getOrderContext(restaurantId: string, orderId: string, confidence: number | null): Promise<OrderContext | null> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, branch: { restaurantId } },
    select: {
      id: true, code: true, deliveredAt: true, estimatedDeliveryAt: true,
      items: { select: { name: true, quantity: true } },
      customer: { select: { phone: true } },
      assignment: { select: { rider: { select: { user: { select: { name: true } } } } } },
    },
  });
  if (!o) return null;
  const riderName = o.assignment?.rider?.user?.name ?? null;
  const lateByMin = o.deliveredAt && o.estimatedDeliveryAt
    ? Math.round((o.deliveredAt.getTime() - o.estimatedDeliveryAt.getTime()) / 60000)
    : null;
  return {
    orderId: o.id, code: o.code, confidence,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    promisedAt: o.estimatedDeliveryAt?.toISOString() ?? null,
    lateByMin,
    riderName,
    privateTerms: [o.code, riderName, riderName?.split(/\s+/)[0], o.customer?.phone].filter((x): x is string => !!x),
  };
}

/** Model-only summary: what was ordered and whether it was late. No identifiers. */
export function privateContextText(ctx: OrderContext | null): string | null {
  if (!ctx) return null;
  const items = ctx.items.map((i) => `${i.name} x${i.quantity}`).join(', ');
  const timing = ctx.lateByMin == null ? '' : ctx.lateByMin > 5
    ? ` Delivered about ${ctx.lateByMin} minutes later than promised.`
    : ' Delivered on time.';
  return `Likely matching order: ${items || 'items unknown'}.${timing}`;
}
