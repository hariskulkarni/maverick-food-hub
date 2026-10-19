import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  integrationCredential: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
const g = vi.hoisted(() => ({ listReviews: vi.fn(), postReply: vi.fn() }));
const llm = vi.hoisted(() => {
  class LlmNotConfiguredError extends Error {
    constructor() { super('No LLM key configured for this restaurant'); this.name = 'LlmNotConfiguredError'; }
  }
  return { generateReviewReply: vi.fn(), LlmNotConfiguredError };
});
const store = vi.hoisted(() => ({ upsertReview: vi.fn(), getAutoReplyConfig: vi.fn(), saveReply: vi.fn(), hasReply: vi.fn() }));

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
  store.hasReply.mockResolvedValue(false);
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

  it('skips (no FAILED row, not counted failed) when no LLM key is configured', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev11', reviewerName: 'G', rating: 5, comment: 'Good', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g8', isNew: true });
    llm.generateReviewReply.mockRejectedValue(new llm.LlmNotConfiguredError());
    const r = await runGoogleReviewsSweep();
    expect(store.saveReply).not.toHaveBeenCalled();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(r.failed).toBe(0);
  });

  it('a listReviews failure for one restaurant does not stop the next restaurant', async () => {
    db.integrationCredential.findMany.mockResolvedValue([{ restaurantId: 'rest1' }, { restaurantId: 'rest2' }]);
    g.listReviews.mockImplementation(async (id: string) => {
      if (id === 'rest1') throw new Error('google down');
      return [{ googleReviewId: 'rev5b', reviewerName: 'D', rating: 5, comment: 'Nice', reviewCreatedAt: new Date() }];
    });
    store.upsertReview.mockResolvedValue({ id: 'g5', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(r.restaurantsScanned).toBe(2);
    expect(g.postReply).toHaveBeenCalledWith('rest2', 'rev5b', 'Thanks!');
    expect(r.autoPosted).toBe(1);
  });

  it('a DB error for one restaurant (config lookup) does not stop the next restaurant', async () => {
    db.integrationCredential.findMany.mockResolvedValue([{ restaurantId: 'rest1' }, { restaurantId: 'rest2' }]);
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev5c', reviewerName: 'E', rating: 5, comment: 'Ok', reviewCreatedAt: new Date() }]);
    store.getAutoReplyConfig.mockRejectedValueOnce(new Error('db down'));
    store.getAutoReplyConfig.mockResolvedValueOnce({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null });
    store.upsertReview.mockResolvedValue({ id: 'g6', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(r.restaurantsScanned).toBe(2);
    expect(g.postReply).toHaveBeenCalledTimes(1);
    expect(g.postReply).toHaveBeenCalledWith('rest2', 'rev5c', 'Thanks!');
  });

  it('a post that succeeds but whose POSTED save throws is not recorded as FAILED', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev10', reviewerName: 'F', rating: 5, comment: 'Yum', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g7', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    store.saveReply.mockRejectedValueOnce(new Error('db write failed'));
    const r = await runGoogleReviewsSweep();
    expect(g.postReply).toHaveBeenCalledWith('rest1', 'rev10', 'Thanks!');
    expect(store.saveReply).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'FAILED' }));
    expect(store.saveReply).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'POSTED', text: 'Thanks!' }));
    expect(r.failed).toBe(0);
    expect(r.autoPosted).toBe(1);
  });

  it('does not re-reply to reviews that already have a reply row', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev9', reviewerName: 'A', rating: 5, comment: 'Great', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g1', isNew: false });
    store.hasReply.mockResolvedValue(true);
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(r.autoPosted).toBe(0);
    expect(r.newReviews).toBe(0);
  });

  it('counts newReviews for isNew sightings even when a reply already exists', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev12', reviewerName: 'A', rating: 5, comment: 'x', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g9', isNew: true });
    store.hasReply.mockResolvedValue(true);
    const r = await runGoogleReviewsSweep();
    expect(r.newReviews).toBe(1);
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
  });

  it('processes a previously-synced (isNew=false) review that has no reply yet', async () => {
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev13', reviewerName: 'M', rating: 5, comment: 'Yum', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g10', isNew: false });
    store.hasReply.mockResolvedValue(false);
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).toHaveBeenCalled();
    expect(g.postReply).toHaveBeenCalledWith('rest1', 'rev13', 'Thanks!');
    expect(r.autoPosted).toBe(1);
    expect(r.newReviews).toBe(0);
  });
});
