/**
 * Platform review analytics — pure aggregation over OrderFeedback (in-app) and
 * GoogleReview rows, plus a prisma-backed loader. Read-only; SUPER_ADMIN only
 * (enforced by the caller).
 */
import { prisma } from '@/server/db';

export type LowStarItem = {
  id: string;
  source: 'in-app' | 'google';
  rating: number;
  comment: string | null;
  at: string;
  restaurantId: string | null;
  restaurantName: string | null;
  orderId: string | null;
  orderCode: string | null;
};

export type ReviewsAnalytics = {
  averages: { food: number | null; delivery: number | null; overall: number | null };
  counts: { feedback: number; google: number };
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  trend: Array<{ day: string; count: number; avgOverall: number | null }>;
  google: { count: number; average: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number> };
  lowStar: LowStarItem[];
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === 'number');
const emptyDist = () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }) as Record<1 | 2 | 3 | 4 | 5, number>;

export function computeReviewsAnalytics(input: { feedback: any[]; google: any[]; now?: Date; lowStarLimit?: number }): ReviewsAnalytics {
  const { feedback, google } = input;
  const limit = input.lowStarLimit ?? 50;

  const distribution = emptyDist();
  for (const f of feedback) {
    const r = f.overallRating;
    if (typeof r === 'number' && r >= 1 && r <= 5) distribution[r as 1 | 2 | 3 | 4 | 5]++;
  }

  const byDay = new Map<string, number[]>();
  const countByDay = new Map<string, number>();
  for (const f of feedback) {
    const day = new Date(f.createdAt).toISOString().slice(0, 10);
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
    if (typeof f.overallRating === 'number') byDay.set(day, [...(byDay.get(day) ?? []), f.overallRating]);
  }
  const trend = [...countByDay.keys()].sort().map((day) => ({
    day,
    count: countByDay.get(day)!,
    avgOverall: avg(byDay.get(day) ?? []),
  }));

  const gDist = emptyDist();
  for (const g of google) if (g.rating >= 1 && g.rating <= 5) gDist[g.rating as 1 | 2 | 3 | 4 | 5]++;

  const low: LowStarItem[] = [];
  for (const f of feedback) {
    if (typeof f.overallRating === 'number' && f.overallRating <= 2) {
      low.push({
        id: f.id, source: 'in-app', rating: f.overallRating, comment: f.comment ?? null,
        at: new Date(f.createdAt).toISOString(),
        restaurantId: f.order?.branch?.restaurantId ?? null,
        restaurantName: f.order?.branch?.restaurant?.name ?? null,
        orderId: f.orderId ?? null, orderCode: f.order?.code ?? null,
      });
    }
  }
  for (const g of google) {
    if (g.rating <= 2) {
      low.push({
        id: g.id, source: 'google', rating: g.rating, comment: g.comment ?? null,
        at: new Date(g.reviewCreatedAt).toISOString(),
        restaurantId: g.restaurantId ?? null, restaurantName: g.restaurant?.name ?? null,
        orderId: null, orderCode: null,
      });
    }
  }
  low.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    averages: {
      food: avg(nums(feedback.map((f) => f.foodRating))),
      delivery: avg(nums(feedback.map((f) => f.deliveryRating))),
      overall: avg(nums(feedback.map((f) => f.overallRating))),
    },
    counts: { feedback: feedback.length, google: google.length },
    distribution,
    trend,
    google: { count: google.length, average: avg(google.map((g) => g.rating)), distribution: gDist },
    lowStar: low.slice(0, limit),
  };
}

export async function loadReviewsAnalytics(days = 30): Promise<ReviewsAnalytics> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [feedback, google] = await Promise.all([
    (prisma as any).orderFeedback.findMany({
      where: { createdAt: { gte: since } },
      include: { order: { select: { code: true, branch: { select: { restaurantId: true, restaurant: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    (prisma as any).googleReview.findMany({
      where: { reviewCreatedAt: { gte: since } },
      include: { restaurant: { select: { name: true } } },
      orderBy: { reviewCreatedAt: 'desc' },
      take: 5000,
    }),
  ]);
  return computeReviewsAnalytics({ feedback, google });
}
