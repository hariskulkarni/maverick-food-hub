import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  integrationCredential: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
const g = vi.hoisted(() => ({ listReviews: vi.fn(), postReply: vi.fn() }));
const llm = vi.hoisted(() => ({ generateReviewReply: vi.fn() }));
const store = vi.hoisted(() => ({ upsertReview: vi.fn(), getAutoReplyConfig: vi.fn(), saveReply: vi.fn() }));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/reviews/google-business', () => g);
vi.mock('@/server/reviews/llm', () => llm);
vi.mock('@/server/reviews/store', () => store);

import { runGoogleReviewsSweep } from '@/server/jobs/google-reviews-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([{ locked: true }]);
  db.integrationCredential.findMany.mockResolvedValue([{ restaurantId: 'rest1' }]);
  g.listReviews.mockResolvedValue([]);
  store.getAutoReplyConfig.mockResolvedValue({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null });
});

describe('runGoogleReviewsSweep', () => {
  it('skips when the advisory lock is not acquired', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    const r = await runGoogleReviewsSweep();
    expect(db.integrationCredential.findMany).not.toHaveBeenCalled();
    expect(r.restaurantsScanned).toBe(0);
  });

  it('auto-posts a reply to a new 5-star review', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev9', reviewerName: 'A', rating: 5, comment: 'Great', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).toHaveBeenCalled();
    expect(g.postReply).toHaveBeenCalledWith('rest1', 'rev9', 'Thanks!');
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'POSTED', source: 'AUTO' }));
    expect(r.autoPosted).toBe(1);
  });

  it('drafts (does not post) a new 2-star review', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev8', reviewerName: 'B', rating: 2, comment: 'Slow', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g2', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Sorry!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'PENDING_APPROVAL', source: 'AUTO' }));
    expect(r.drafted).toBe(1);
  });

  it('parks a per-review failure without aborting the sweep', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev7', reviewerName: 'C', rating: 5, comment: 'x', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g3', isNew: true });
    llm.generateReviewReply.mockRejectedValue(new Error('llm down'));
    const r = await runGoogleReviewsSweep();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'FAILED' }));
    expect(r.failed).toBe(1);
  });

  it('does not re-reply to reviews that already existed', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev9', reviewerName: 'A', rating: 5, comment: 'Great', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g1', isNew: false });
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
    expect(r.autoPosted).toBe(0);
  });
});
