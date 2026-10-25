import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  googleReview: { findMany: vi.fn(), count: vi.fn() },
  menuItem: { findMany: vi.fn() },
  restaurantUser: { findMany: vi.fn() },
  riderProfile: { findMany: vi.fn() },
  reviewAnalysis: { upsert: vi.fn(), deleteMany: vi.fn() },
  reviewInsightsSnapshot: { upsert: vi.fn(), findUnique: vi.fn() },
  reviewResponseSettings: { findUnique: vi.fn() },
}));
const llm = vi.hoisted(() => {
  class LlmNotConfiguredError extends Error {}
  return { analyzeReviewsBatch: vi.fn(), LlmNotConfiguredError };
});
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/reviews/llm', () => llm);
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dishKeys, analyzeKeywords, median, analyzePending, computeInsights, refreshInsights, getCachedInsights, invalidateAnalysis } from '@/server/reviews/insights';

beforeEach(() => {
  vi.clearAllMocks();
  db.menuItem.findMany.mockResolvedValue([{ name: 'Chicken Dum Biryani' }, { name: 'Veg Biryani' }, { name: 'Masala Dosa' }, { name: 'Family Combo' }]);
  db.restaurantUser.findMany.mockResolvedValue([{ user: { name: 'Priya Sharma' } }]);
  db.riderProfile.findMany.mockResolvedValue([{ user: { name: 'ravi kumar' } }]);
  db.reviewResponseSettings.findUnique.mockResolvedValue(null);
});

describe('dishKeys', () => {
  it('keeps full names and adds distinctive head nouns, skipping generic ones', () => {
    const k = dishKeys(['Chicken Dum Biryani', 'Veg Biryani', 'Family Combo']);
    expect(k.get('biryani')).toBe('Biryani');
    expect(k.get('chicken dum biryani')).toBe('Chicken Dum Biryani');
    expect(k.has('combo')).toBe(false);
  });
});

describe('analyzeKeywords', () => {
  const keys = dishKeys(['Chicken Dum Biryani', 'Masala Dosa', 'Veg Biryani']);
  it('maps dishes to the menu with per-sentence sentiment and finds issues + staff names', () => {
    const a = analyzeKeywords('The biryani was delicious. But the masala dosa arrived cold and late. Priya was lovely.', 3, keys, ['Priya', 'Ravi']);
    expect(a.dishes).toEqual([{ name: 'Biryani', sentiment: 'positive' }, { name: 'Masala Dosa', sentiment: 'negative' }]);
    expect(a.issues).toEqual(['cold', 'late']);
    expect(a.staff).toEqual(['Priya']);
  });
  it('prefers the full dish name over the head noun', () => {
    expect(analyzeKeywords('Chicken Dum Biryani rocks', 5, keys).dishes).toEqual([{ name: 'Chicken Dum Biryani', sentiment: 'positive' }]);
  });
  it('rating drives overall sentiment; no text → no topics', () => {
    expect(analyzeKeywords(null, 1, keys)).toEqual({ sentiment: 'negative', issues: [], dishes: [], staff: [] });
    expect(analyzeKeywords('', 5, keys).sentiment).toBe('positive');
  });
  it('detects price, portion, packaging and staff behaviour issues', () => {
    expect(analyzeKeywords('Overpriced, tiny portion, the container leaked and the staff were rude', 2, keys).issues)
      .toEqual(['packaging', 'portion', 'price', 'staff']);
  });
});

describe('median', () => {
  it('handles empty, odd and even', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('analyzePending', () => {
  it('uses the LLM for reviews with text and stores method=llm, keyword for the rest', async () => {
    db.googleReview.findMany.mockResolvedValue([{ id: 'a', rating: 5, comment: 'Biryani!' }, { id: 'b', rating: 4, comment: null }]);
    llm.analyzeReviewsBatch.mockResolvedValue([{ id: 'a', sentiment: 'positive', issues: [], dishes: [{ name: 'Biryani', sentiment: 'positive' }] }]);
    expect(await analyzePending('rest1')).toBe(2);
    expect(llm.analyzeReviewsBatch).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'rest1', reviews: [{ id: 'a', rating: 5, text: 'Biryani!' }] }));
    expect(llm.analyzeReviewsBatch.mock.calls[0][0].menu).toContain('Biryani');
    const methods = db.reviewAnalysis.upsert.mock.calls.map((c: any[]) => [c[0].where.reviewId, c[0].create.method]);
    expect(methods).toEqual([['a', 'llm'], ['b', 'keyword']]);
    expect(db.googleReview.findMany.mock.calls[0][0].where.restaurantId).toBe('rest1');
  });
  it('falls back to keywords when there is no LLM key', async () => {
    db.googleReview.findMany.mockResolvedValue([{ id: 'a', rating: 1, comment: 'masala dosa was cold' }]);
    llm.analyzeReviewsBatch.mockRejectedValue(new llm.LlmNotConfiguredError());
    await analyzePending('rest1');
    expect(db.reviewAnalysis.upsert.mock.calls[0][0].create).toMatchObject({ method: 'keyword', issues: ['cold'], dishes: [{ name: 'Masala Dosa', sentiment: 'negative' }] });
  });
  it('no-op when everything is analysed', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    expect(await analyzePending('rest1')).toBe(0);
    expect(db.menuItem.findMany).not.toHaveBeenCalled();
  });
});

describe('computeInsights', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  const d = (iso: string) => new Date(iso);
  it('computes totals, distribution, weekly trend, dishes, issues and alphabetical staff mentions', async () => {
    db.googleReview.findMany.mockResolvedValue([
      { rating: 5, reviewCreatedAt: d('2026-10-20T10:00:00Z'), reply: { state: 'POSTED', postedAt: d('2026-10-20T12:00:00Z') },
        analysis: { sentiment: 'positive', issues: [], dishes: [{ name: 'Biryani', sentiment: 'positive' }], staff: ['Ravi'], method: 'llm' } },
      { rating: 1, reviewCreatedAt: d('2026-10-21T10:00:00Z'), reply: null,
        analysis: { sentiment: 'negative', issues: ['cold', 'late'], dishes: [{ name: 'Biryani', sentiment: 'negative' }], staff: ['Anil'], method: 'keyword' } },
      { rating: 4, reviewCreatedAt: d('2026-10-13T10:00:00Z'), reply: { state: 'POSTED', postedAt: d('2026-10-13T20:00:00Z') }, analysis: null },
    ]);
    db.googleReview.count.mockResolvedValue(1);
    db.reviewResponseSettings.findUnique.mockResolvedValue({ slaHours: 24, googleAverageRating: 4.1, googleTotalReviewCount: 300, skipKeywords: [] });
    const x = await computeInsights('rest1', { now });
    expect(x.totals).toEqual({ reviews: 3, average: 3.3, replyRate: 67, medianReplyHours: 6, overdue: 1 });
    expect(x.distribution).toEqual({ '1': 1, '2': 0, '3': 0, '4': 1, '5': 1 });
    expect(x.weekly).toEqual([{ week: '2026-10-12', count: 1, average: 4 }, { week: '2026-10-19', count: 2, average: 3 }]);
    expect(x.dishes).toEqual([{ name: 'Biryani', mentions: 2, positivePct: 50 }]);
    expect(x.issues.map((i) => i.key)).toEqual(['cold', 'late']);
    expect(x.staffMentions).toEqual([{ name: 'Anil', mentions: 1 }, { name: 'Ravi', mentions: 1 }]);
    expect(x.analysis).toEqual({ analyzed: 2, method: 'mixed' });
    expect(x.google).toEqual({ average: 4.1, total: 300 });
    expect(db.googleReview.findMany.mock.calls[0][0].where.restaurantId).toBe('rest1');
  });
  it('empty period', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    db.googleReview.count.mockResolvedValue(0);
    const x = await computeInsights('rest1', { now });
    expect(x.totals).toEqual({ reviews: 0, average: null, replyRate: null, medianReplyHours: null, overdue: 0 });
    expect(x.analysis.method).toBe('none');
    expect(x.google).toBeNull();
  });
});

describe('snapshot cache', () => {
  it('refreshInsights analyses, computes and upserts the snapshot', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    db.googleReview.count.mockResolvedValue(0);
    await refreshInsights('rest1');
    expect(db.reviewInsightsSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { restaurantId: 'rest1' } }));
  });
  it('getCachedInsights returns null when not computed', async () => {
    db.reviewInsightsSnapshot.findUnique.mockResolvedValue(null);
    expect(await getCachedInsights('rest1')).toBeNull();
  });
  it('invalidateAnalysis deletes the analysis row', async () => {
    await invalidateAnalysis('g1');
    expect(db.reviewAnalysis.deleteMany).toHaveBeenCalledWith({ where: { reviewId: 'g1' } });
  });
});
