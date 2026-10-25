import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  integrationCredential: { findMany: vi.fn() },
  reviewResponseSettings: { upsert: vi.fn() },
  googleReview: { count: vi.fn() },
}));
const lease = vi.hoisted(() => ({ acquireJobLease: vi.fn(async (): Promise<string | null> => 'tok1'), releaseJobLease: vi.fn(async () => {}) }));
vi.mock('@/server/jobs/lease', () => lease);
// listReviews is the test-facing alias; the sweep calls fetchReviews (reviews + location totals).
const g = vi.hoisted(() => {
  const listReviews = vi.fn();
  return {
    listReviews,
    fetchReviews: vi.fn(async (id: string): Promise<{ reviews: any[]; averageRating: number | null; totalReviewCount: number | null }> =>
      ({ reviews: await listReviews(id), averageRating: null, totalReviewCount: null })),
    postReply: vi.fn(),
    safeErrorMessage: vi.fn(() => 'Google is unavailable right now. Try again later.'),
  };
});
const llm = vi.hoisted(() => {
  class LlmNotConfiguredError extends Error {
    constructor() { super('No LLM key configured for this restaurant'); this.name = 'LlmNotConfiguredError'; }
  }
  return { generateReviewReply: vi.fn(), LlmNotConfiguredError };
});
const store = vi.hoisted(() => ({
  upsertReview: vi.fn(), getAutoReplyConfig: vi.fn(), saveReply: vi.fn(), hasReply: vi.fn(),
  syncGoogleReply: vi.fn(), getResponseSettings: vi.fn(), saveGoogleStats: vi.fn(), recentPostedReplies: vi.fn(),
}));
const match = vi.hoisted(() => ({ matchAndStore: vi.fn(), getOrderContext: vi.fn(), privateContextText: vi.fn((): string | null => null) }));
const insights = vi.hoisted(() => ({ refreshInsights: vi.fn(), invalidateAnalysis: vi.fn() }));
const alerts = vi.hoisted(() => ({ sendNegativeReviewAlerts: vi.fn(), runSlaEscalations: vi.fn(), ALERT_FRESH_HOURS: 48 }));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/reviews/google-business', () => g);
vi.mock('@/server/reviews/llm', () => llm);
vi.mock('@/server/reviews/store', () => store);
vi.mock('@/server/reviews/order-match', () => match);
vi.mock('@/server/reviews/insights', () => insights);
vi.mock('@/server/reviews/review-alerts', () => alerts);

import { runGoogleReviewsSweep, isDailyFullSyncSlot } from '@/server/jobs/google-reviews-sweep';

beforeEach(() => {
  vi.clearAllMocks();
  lease.acquireJobLease.mockResolvedValue('tok1');
  db.integrationCredential.findMany.mockResolvedValue([{ restaurantId: 'rest1' }]);
  g.listReviews.mockResolvedValue([]);
  store.hasReply.mockResolvedValue(false);
  store.saveGoogleStats.mockResolvedValue(undefined);
  store.recentPostedReplies.mockResolvedValue([]);
  store.syncGoogleReply.mockResolvedValue(true);
  store.getResponseSettings.mockResolvedValue({ skipKeywords: ['refund', 'food poisoning'], alertMaxRating: 2, brandVoiceSummary: 'we; casual', brandVoiceUpdatedAt: new Date() });
  db.reviewResponseSettings.upsert.mockResolvedValue({});
  db.googleReview.count.mockResolvedValue(5);
  match.matchAndStore.mockResolvedValue(null);
  insights.refreshInsights.mockResolvedValue({});
  insights.invalidateAnalysis.mockResolvedValue(undefined);
  alerts.sendNegativeReviewAlerts.mockResolvedValue(0);
  alerts.runSlaEscalations.mockResolvedValue(0);
  store.getAutoReplyConfig.mockResolvedValue({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: new Date('2020-01-01') });
});

describe('runGoogleReviewsSweep', () => {
  it('skips when the job lease is held by another run', async () => {
    lease.acquireJobLease.mockResolvedValueOnce(null);
    const r = await runGoogleReviewsSweep();
    expect(db.integrationCredential.findMany).not.toHaveBeenCalled();
    expect(r.restaurantsScanned).toBe(0);
    expect(lease.releaseJobLease).not.toHaveBeenCalled();
  });

  it('F9: takes and releases its own lease (no advisory lock)', async () => {
    await runGoogleReviewsSweep();
    expect(lease.acquireJobLease).toHaveBeenCalledWith('google-reviews-sweep', expect.any(Number));
    expect(lease.releaseJobLease).toHaveBeenCalledWith('google-reviews-sweep', 'tok1');
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
    store.getAutoReplyConfig.mockResolvedValueOnce({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: new Date('2020-01-01') });
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

  it('forward-only: a review older than enabledAt is not auto-replied; a newer one is', async () => {
    store.getAutoReplyConfig.mockResolvedValue({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: new Date('2025-06-01') });
    g.listReviews.mockResolvedValue([
      { googleReviewId: 'old', reviewerName: 'O', rating: 5, comment: 'old', reviewCreatedAt: new Date('2025-01-01') },
      { googleReviewId: 'new', reviewerName: 'N', rating: 5, comment: 'new', reviewCreatedAt: new Date('2025-07-01') },
    ]);
    store.upsertReview.mockResolvedValueOnce({ id: 'o1', isNew: true }).mockResolvedValueOnce({ id: 'n1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'nvidia', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(g.postReply).toHaveBeenCalledTimes(1);
    expect(g.postReply).toHaveBeenCalledWith('rest1', 'new', 'Thanks!');
    expect(r.autoPosted).toBe(1);
  });

  it('fail-closed: enabled config with null enabledAt never auto-replies', async () => {
    store.getAutoReplyConfig.mockResolvedValue({ enabled: true, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: null });
    g.listReviews.mockResolvedValue([{ googleReviewId: 'rev14', reviewerName: 'P', rating: 5, comment: 'x', reviewCreatedAt: new Date() }]);
    store.upsertReview.mockResolvedValue({ id: 'g11', isNew: true });
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(r.autoPosted).toBe(0);
    expect(r.failed).toBe(0);
  });

  // ---- Review response & insights ----
  const rv = (o: Partial<any> = {}) => ({ googleReviewId: 'gx', reviewerName: 'Asha', rating: 5, comment: 'Great', reviewCreatedAt: new Date(), ...o });

  it('mirrors a reply that already exists on Google: no LLM call, no post', async () => {
    g.listReviews.mockResolvedValue([rv({ existingReply: { comment: 'Thanks!', updateTime: new Date(), moderationState: 'APPROVED', policyViolation: null, reviewReplyUrl: null } })]);
    store.upsertReview.mockResolvedValue({ id: 'e1', isNew: true, edited: false });
    const r = await runGoogleReviewsSweep();
    expect(store.syncGoogleReply).toHaveBeenCalledWith('e1', 'rest1', expect.objectContaining({ comment: 'Thanks!' }));
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(r.repliesImported).toBe(1);
  });

  it('invalidates insights analysis for an edited review', async () => {
    g.listReviews.mockResolvedValue([rv()]);
    store.upsertReview.mockResolvedValue({ id: 'ed1', isNew: false, edited: true });
    store.hasReply.mockResolvedValue(true);
    await runGoogleReviewsSweep();
    expect(insights.invalidateAnalysis).toHaveBeenCalledWith('ed1');
  });

  it('holds a 5-star review mentioning a sensitive keyword instead of auto-posting', async () => {
    g.listReviews.mockResolvedValue([rv({ comment: 'Food was great but I want a refund for the delay' })]);
    store.upsertReview.mockResolvedValue({ id: 'k1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thank you!', provider: 'p', model: 'm' });
    const r = await runGoogleReviewsSweep();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'PENDING_APPROVAL', holdReason: expect.stringContaining('refund') }));
    expect(r.held).toBe(1);
  });

  it('holds an AI draft that fails the safety filter (phone number) instead of auto-posting', async () => {
    g.listReviews.mockResolvedValue([rv()]);
    store.upsertReview.mockResolvedValue({ id: 's1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks! Call us on 98765 43210.', provider: 'p', model: 'm' });
    await runGoogleReviewsSweep();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'PENDING_APPROVAL', holdReason: expect.stringContaining('Safety filter') }));
  });

  it('records SKIPPED with a reason for ratings between the thresholds', async () => {
    store.getAutoReplyConfig.mockResolvedValue({ enabled: true, autoPostMinRating: 5, draftMaxRating: 2, tonePrompt: null, enabledAt: new Date('2020-01-01') });
    g.listReviews.mockResolvedValue([rv({ rating: 4 })]);
    store.upsertReview.mockResolvedValue({ id: 'sk1', isNew: true });
    const r = await runGoogleReviewsSweep();
    expect(llm.generateReviewReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'sk1', state: 'SKIPPED', text: '', holdReason: expect.stringContaining('4★') }));
    expect(r.skipped).toBe(1);
  });

  it('alerts on a fresh low-rated review and includes the AI draft', async () => {
    g.listReviews.mockResolvedValue([rv({ rating: 1, comment: 'Cold food' })]);
    store.upsertReview.mockResolvedValue({ id: 'n1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'We are sorry.', provider: 'p', model: 'm' });
    alerts.sendNegativeReviewAlerts.mockResolvedValue(1);
    const r = await runGoogleReviewsSweep();
    expect(alerts.sendNegativeReviewAlerts).toHaveBeenCalledWith('rest1', [expect.objectContaining({ id: 'n1', rating: 1, draft: 'We are sorry.' })], expect.any(Date));
    expect(r.alerted).toBe(1);
  });

  it('prepares an approval draft for the alert even when auto-reply is off', async () => {
    store.getAutoReplyConfig.mockResolvedValue({ enabled: false, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null, enabledAt: null });
    g.listReviews.mockResolvedValue([rv({ rating: 2 })]);
    store.upsertReview.mockResolvedValue({ id: 'n2', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Sorry about that.', provider: 'p', model: 'm' });
    await runGoogleReviewsSweep();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'n2', state: 'PENDING_APPROVAL' }));
    expect(alerts.sendNegativeReviewAlerts.mock.calls[0][1][0].draft).toBe('Sorry about that.');
  });

  it('does not alert for an old low-rated review (first import)', async () => {
    g.listReviews.mockResolvedValue([rv({ rating: 1, reviewCreatedAt: new Date('2024-01-01') })]);
    store.upsertReview.mockResolvedValue({ id: 'o9', isNew: true });
    await runGoogleReviewsSweep();
    expect(alerts.sendNegativeReviewAlerts).not.toHaveBeenCalled();
  });

  it('matches a new review to an order and passes private context to the AI only', async () => {
    g.listReviews.mockResolvedValue([rv()]);
    store.upsertReview.mockResolvedValue({ id: 'm1', isNew: true });
    match.matchAndStore.mockResolvedValue({ orderId: 'o1', confidence: 0.9 });
    match.getOrderContext.mockResolvedValue({ orderId: 'o1', code: 'ORD-AB12', privateTerms: ['ORD-AB12', 'Ravi'] });
    match.privateContextText.mockReturnValue('Likely matching order: Biryani x1.');
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'p', model: 'm' });
    await runGoogleReviewsSweep();
    expect(match.matchAndStore).toHaveBeenCalledWith('rest1', expect.objectContaining({ id: 'm1' }));
    expect(llm.generateReviewReply).toHaveBeenCalledWith(expect.objectContaining({ privateContext: 'Likely matching order: Biryani x1.', voice: 'we; casual' }));
  });

  it('blocks auto-post when the AI echoes the matched order code', async () => {
    g.listReviews.mockResolvedValue([rv()]);
    store.upsertReview.mockResolvedValue({ id: 'm2', isNew: true });
    match.matchAndStore.mockResolvedValue({ orderId: 'o1', confidence: 0.9 });
    match.getOrderContext.mockResolvedValue({ orderId: 'o1', code: 'ORD-AB12', privateTerms: ['ORD-AB12', 'Ravi'] });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks! Ravi will be glad to hear it.', provider: 'p', model: 'm' });
    await runGoogleReviewsSweep();
    expect(g.postReply).not.toHaveBeenCalled();
    expect(store.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'PENDING_APPROVAL' }));
  });

  it('stores Google totals, refreshes insights and runs SLA escalations', async () => {
    g.fetchReviews.mockResolvedValueOnce({ reviews: [], averageRating: 4.4, totalReviewCount: 321 });
    alerts.runSlaEscalations.mockResolvedValue(2);
    const r = await runGoogleReviewsSweep();
    expect(store.saveGoogleStats).toHaveBeenCalledWith('rest1', expect.objectContaining({ averageRating: 4.4, totalReviewCount: 321 }));
    expect(insights.refreshInsights).toHaveBeenCalledWith('rest1');
    expect(r.escalated).toBe(2);
  });

  it('a targeted (Pub/Sub) run scopes to the restaurant and skips SLA escalations', async () => {
    await runGoogleReviewsSweep({ restaurantIds: ['rest9'] });
    expect(db.integrationCredential.findMany.mock.calls[0][0].where.restaurantId).toEqual({ in: ['rest9'] });
    expect(alerts.runSlaEscalations).not.toHaveBeenCalled();
  });

  it('stores an owner-safe message (not the upstream body) when posting fails', async () => {
    g.listReviews.mockResolvedValue([rv()]);
    store.upsertReview.mockResolvedValue({ id: 'f1', isNew: true });
    llm.generateReviewReply.mockResolvedValue({ text: 'Thanks!', provider: 'p', model: 'm' });
    g.postReply.mockRejectedValueOnce(new Error('google reply 500: {"secret":"upstream"}'));
    await runGoogleReviewsSweep();
    const failed = store.saveReply.mock.calls.find((c: any[]) => c[0].state === 'FAILED')![0];
    expect(failed.error).toBe('Google is unavailable right now. Try again later.');
    expect(failed.text).toBe('Thanks!');
  });

  it('re-learns the brand voice when stale', async () => {
    store.getResponseSettings.mockResolvedValue({ skipKeywords: [], alertMaxRating: 2, brandVoiceSummary: null, brandVoiceUpdatedAt: null });
    store.recentPostedReplies.mockResolvedValue(['Thanks so much! - Team Spice', "We're glad! - Team Spice", 'Thank you! - Team Spice']);
    await runGoogleReviewsSweep();
    expect(db.reviewResponseSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ brandVoiceSummary: expect.stringContaining('Team Spice') }),
    }));
  });

  it('first import is a full sync; later runs are incremental (14-day horizon)', async () => {
    const now = new Date('2026-10-24T10:00:00Z'); // 15:30 IST: not the daily full slot
    db.googleReview.count.mockResolvedValueOnce(0);
    await runGoogleReviewsSweep({ now });
    expect(g.fetchReviews).toHaveBeenLastCalledWith('rest1', {});
    await runGoogleReviewsSweep({ now });
    expect(g.fetchReviews).toHaveBeenLastCalledWith('rest1', { stopBefore: new Date(now.getTime() - 14 * 86_400_000) });
  });

  it('the 03:00 IST run is a full sync', async () => {
    const now = new Date('2026-10-23T21:35:00Z'); // 03:05 IST
    expect(isDailyFullSyncSlot(now)).toBe(true);
    expect(isDailyFullSyncSlot(new Date('2026-10-23T21:50:00Z'))).toBe(false);
    await runGoogleReviewsSweep({ now });
    expect(g.fetchReviews).toHaveBeenLastCalledWith('rest1', {});
  });
});
