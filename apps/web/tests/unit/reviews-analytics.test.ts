import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireSuperAdmin = vi.fn();
vi.mock('@/server/tenancy', () => ({ requireSuperAdmin: (...a: any[]) => requireSuperAdmin(...a) }));

const fbFindMany = vi.fn();
const grFindMany = vi.fn();
vi.mock('@/server/db', () => ({
  prisma: { orderFeedback: { findMany: (...a: any[]) => fbFindMany(...a) }, googleReview: { findMany: (...a: any[]) => grFindMany(...a) } },
}));

import { GET } from '@/app/api/platform/reviews-analytics/route';
import { computeReviewsAnalytics } from '@/server/reviews-analytics';

const NOW = new Date('2026-10-19T12:00:00Z');
const fb = (id: string, food: number | null, del: number | null, overall: number | null, day: string, extra: any = {}) => ({
  id, orderId: 'o' + id, foodRating: food, deliveryRating: del, overallRating: overall,
  comment: 'c' + id, createdAt: new Date(`${day}T10:00:00Z`),
  order: { code: 'C' + id, branch: { restaurantId: 'r1', restaurant: { name: 'Spice' } } }, ...extra,
});
const gr = (id: string, rating: number, day: string) => ({
  id, rating, comment: 'g' + id, reviewerName: 'Pat', reviewCreatedAt: new Date(`${day}T09:00:00Z`),
  restaurantId: 'r2', restaurant: { name: 'Dosa Hub' },
});

describe('computeReviewsAnalytics', () => {
  const feedback = [
    fb('1', 5, 4, 5, '2026-10-18'),
    fb('2', 3, 2, 2, '2026-10-18'),
    fb('3', 1, null, 1, '2026-10-17'),
    fb('4', 4, 4, null, '2026-10-17'),
  ];
  const google = [gr('a', 2, '2026-10-16'), gr('b', 5, '2026-10-16'), gr('c', 1, '2026-10-15')];
  const out = computeReviewsAnalytics({ feedback, google, now: NOW });

  it('averages per criterion ignoring nulls', () => {
    expect(out.averages.food).toBeCloseTo(3.25, 2);
    expect(out.averages.delivery).toBeCloseTo(3.33, 2);
    expect(out.averages.overall).toBeCloseTo(2.67, 2);
    expect(out.counts.feedback).toBe(4);
  });
  it('builds overall distribution 1..5', () => {
    expect(out.distribution).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 1 });
  });
  it('builds daily volume trend sorted ascending', () => {
    expect(out.trend).toEqual([
      { day: '2026-10-17', count: 2, avgOverall: 1 },
      { day: '2026-10-18', count: 2, avgOverall: 3.5 },
    ]);
  });
  it('low-star list contains only <=2 star, links included, newest first', () => {
    const ids = out.lowStar.map((l) => l.id);
    expect(ids).toEqual(['2', '3', 'a', 'c'].sort((x, y) => ids.indexOf(x) - ids.indexOf(y)));
    expect(out.lowStar.every((l) => l.rating <= 2)).toBe(true);
    expect(out.lowStar).toHaveLength(4);
    const inApp = out.lowStar.find((l) => l.id === '2')!;
    expect(inApp.source).toBe('in-app');
    expect(inApp.orderId).toBe('o2');
    expect(inApp.restaurantId).toBe('r1');
    expect(out.lowStar.find((l) => l.id === 'a')!.source).toBe('google');
    expect(out.lowStar[0].at >= out.lowStar[1].at).toBe(true);
  });
  it('google summary', () => {
    expect(out.google.count).toBe(3);
    expect(out.google.average).toBeCloseTo(2.67, 2);
  });
});

describe('GET /api/platform/reviews-analytics', () => {
  beforeEach(() => { vi.clearAllMocks(); fbFindMany.mockResolvedValue([]); grFindMany.mockResolvedValue([]); });

  it('returns 403 for non-SUPER_ADMIN', async () => {
    requireSuperAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }));
    const res = await GET(new Request('http://x/api/platform/reviews-analytics') as any);
    expect(res.status).toBe(403);
    expect(fbFindMany).not.toHaveBeenCalled();
  });
  it('returns analytics for SUPER_ADMIN', async () => {
    requireSuperAdmin.mockResolvedValue({ user: { role: 'SUPER_ADMIN' } });
    fbFindMany.mockResolvedValue([fb('1', 5, 5, 5, '2026-10-18')]);
    const res = await GET(new Request('http://x/api/platform/reviews-analytics?days=30') as any);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.averages.overall).toBe(5);
  });
});
