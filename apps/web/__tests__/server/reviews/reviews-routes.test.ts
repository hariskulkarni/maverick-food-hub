import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  class GoogleApiError extends Error {
    constructor(public status: number, public safeMessage: string) { super(`google ${status}: upstream body`); }
  }
  return {
    requireManagedRestaurant: vi.fn(), getReviewScoped: vi.fn(), saveReply: vi.fn(),
    listForAdmin: vi.fn(), gen: vi.fn(), post: vi.fn(), cfg: vi.fn(), settings: vi.fn(),
    getOrderContext: vi.fn(), matchAndStore: vi.fn(), audit: vi.fn(),
    LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
    GoogleApiError,
  };
});
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/reviews/store', () => ({
  getReviewScoped: h.getReviewScoped, saveReply: h.saveReply,
  listReviewsForAdmin: h.listForAdmin, getAutoReplyConfig: h.cfg, getResponseSettings: h.settings,
}));
vi.mock('@/server/reviews/llm', () => ({ generateReviewReply: h.gen, LlmNotConfiguredError: h.LlmNotConfiguredError }));
vi.mock('@/server/reviews/google-business', () => ({
  postReply: h.post,
  safeErrorMessage: (e: unknown) => (e instanceof h.GoogleApiError ? e.safeMessage : /not connected/i.test(String((e as Error)?.message)) ? 'Google Business not connected' : 'Could not reach Google. Try again later.'),
}));
vi.mock('@/server/reviews/order-match', () => ({
  getOrderContext: h.getOrderContext, matchAndStore: h.matchAndStore,
  privateContextText: (c: any) => (c ? `Likely matching order: ${c.items.map((i: any) => i.name).join(', ')}.` : null),
}));
vi.mock('@/server/reviews/review-audit', () => ({ auditReview: h.audit }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from '@/app/api/admin/reviews/route';
import { POST as generate } from '@/app/api/admin/reviews/[id]/generate/route';
import { POST as approve } from '@/app/api/admin/reviews/[id]/approve/route';
import { POST as reply, PUT as saveDraft } from '@/app/api/admin/reviews/[id]/reply/route';
import { GET as orderCtx, POST as rematch } from '@/app/api/admin/reviews/[id]/order-context/route';

const ctx = (id = 'rv1') => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = (body?: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const ORDER = {
  orderId: 'o1', code: 'ORD-AB12', confidence: 0.9, items: [{ name: 'Chicken Biryani', quantity: 1 }],
  deliveredAt: null, promisedAt: null, lateByMin: 20, riderName: 'Ravi Kumar', privateTerms: ['ORD-AB12', 'Ravi Kumar', 'Ravi'],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.settings.mockResolvedValue({ slaHours: 24, brandVoiceSummary: 'we; casual' });
  h.post.mockResolvedValue({ moderationState: null, policyViolation: null, reviewReplyUrl: null });
  h.getOrderContext.mockResolvedValue(null);
  h.saveReply.mockResolvedValue(undefined);
});

describe('admin reviews routes', () => {
  it('GET lists scoped, returns DTO only with no secrets', async () => {
    h.listForAdmin.mockResolvedValue({ nextCursor: null, items: [{
      id: 'rv1', reviewerName: 'Ann', rating: 5, comment: 'great', reviewCreatedAt: new Date('2026-01-01'), reviewUpdatedAt: null, source: 'gbp',
      googleReviewId: 'g1', restaurantId: 'rest1', apiKey: 'sekret', refreshToken: 'rt', configEncrypted: 'enc', matchedOrderId: 'o1',
      reply: { state: 'POSTED', text: 'thanks', source: 'AUTO', postedAt: new Date('2026-01-02'), llmModel: 'm', error: null },
    }] });
    const res = await GET(new NextRequest('http://localhost/api/admin/reviews'));
    expect(h.listForAdmin).toHaveBeenCalledWith('rest1', expect.anything());
    const json = await res.json();
    const s = JSON.stringify(json);
    expect(s).not.toContain('apiKey');
    expect(s).not.toContain('refreshToken');
    expect(s).not.toContain('configEncrypted');
    expect(s).not.toContain('o1'); // matched order id is never in the list DTO
    expect(Object.keys(json.reviews[0]).sort()).toEqual(
      ['comment', 'hasOrderMatch', 'id', 'media', 'overdue', 'rating', 'reply', 'reviewCreatedAt', 'reviewUpdatedAt', 'reviewerName', 'source']);
    expect(Object.keys(json.reviews[0].reply).sort()).toEqual(
      ['error', 'holdReason', 'moderationState', 'policyViolation', 'postedAt', 'reviewReplyUrl', 'source', 'state', 'text']);
    expect(json.reviews[0].overdue).toBe(false); // POSTED
    expect(json.reviews[0].hasOrderMatch).toBe(true);
  });

  it('GET passes cursor, search and overdue (with the SLA hours) and ignores bad filters', async () => {
    h.listForAdmin.mockResolvedValue({ nextCursor: 'c2', items: [] });
    const res = await GET(new NextRequest('http://localhost/api/admin/reviews?cursor=c1&q=cold&overdue=1&state=BOGUS&rating=9'));
    expect(h.listForAdmin).toHaveBeenCalledWith('rest1', expect.objectContaining({
      cursor: 'c1', q: 'cold', overdueSlaHours: 24, state: undefined, rating: undefined,
    }));
    expect(await res.json()).toMatchObject({ nextCursor: 'c2', slaHours: 24, reviews: [] });
  });

  it('GET marks an old unreplied Business Profile review overdue', async () => {
    h.listForAdmin.mockResolvedValue({ nextCursor: null, items: [
      { id: 'a', source: 'gbp', reviewCreatedAt: new Date(Date.now() - 30 * 3_600_000), reply: null, rating: 2 },
      { id: 'b', source: 'places', reviewCreatedAt: new Date(Date.now() - 30 * 3_600_000), reply: null, rating: 2 },
    ] });
    const json = await (await GET(new NextRequest('http://localhost/api/admin/reviews'))).json();
    expect(json.reviews.map((r: any) => r.overdue)).toEqual([true, false]);
  });

  it('generate returns 404 for unknown/foreign review and does not call LLM', async () => {
    h.getReviewScoped.mockResolvedValue(null);
    const res = await generate(post(), ctx());
    expect(res.status).toBe(404);
    expect(h.getReviewScoped).toHaveBeenCalledWith('rest1', 'rv1');
    expect(h.gen).not.toHaveBeenCalled();
  });

  it('generate saves a PENDING_APPROVAL draft using tone + learned voice, and audits', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 4, comment: 'ok' });
    h.cfg.mockResolvedValue({ tonePrompt: 'warm' });
    h.gen.mockResolvedValue({ text: 'draft', provider: 'p', model: 'm' });
    const res = await generate(post(), ctx());
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: 'rest1', rating: 4, comment: 'ok', tone: 'warm', voice: 'we; casual', rejectionReason: null }));
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'rv1', restaurantId: 'rest1', text: 'draft', state: 'PENDING_APPROVAL', source: 'AUTO' }));
    expect(await res.json()).toEqual({ ok: true, text: 'draft', issues: [] });
    expect(h.audit).toHaveBeenCalledWith('reviews.reply.generate', 'rest1', expect.objectContaining({ entityId: 'rv1' }));
  });

  it('generate = Redraft when Google rejected the reply: feeds the reason to the model', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 2, comment: 'meh', reply: { state: 'POSTED', moderationState: 'REJECTED', policyViolation: 'Contains a phone number' } });
    h.cfg.mockResolvedValue(null);
    h.gen.mockResolvedValue({ text: 'Sorry, please reach out via the app.', provider: 'p', model: 'm' });
    await generate(post(), ctx());
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ rejectionReason: 'Contains a phone number' }));
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'PENDING_APPROVAL', holdReason: expect.stringContaining('Google rejected') }));
  });

  it('generate flags an unsafe AI draft (issues + holdReason)', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 5, comment: 'yum' });
    h.cfg.mockResolvedValue(null);
    h.gen.mockResolvedValue({ text: 'Thanks! Get 10% off your next order.', provider: 'p', model: 'm' });
    const json = await (await generate(post(), ctx())).json();
    expect(json.issues.map((i: any) => i.code)).toContain('incentive');
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ holdReason: expect.stringContaining('Safety filter') }));
  });

  it('generate feeds matched order context privately to the model', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 2, comment: 'late', matchedOrderId: 'o1', matchConfidence: 0.9 });
    h.cfg.mockResolvedValue(null);
    h.getOrderContext.mockResolvedValue(ORDER);
    h.gen.mockResolvedValue({ text: 'Sorry it was late.', provider: 'p', model: 'm' });
    await generate(post(), ctx());
    expect(h.getOrderContext).toHaveBeenCalledWith('rest1', 'o1', 0.9);
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ privateContext: 'Likely matching order: Chicken Biryani.' }));
  });

  it('generate returns 400 (not 500) when no LLM key is configured', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 4, comment: 'ok' });
    h.cfg.mockResolvedValue(null);
    h.gen.mockRejectedValue(new h.LlmNotConfiguredError());
    const res = await generate(post(), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No LLM key configured' });
    expect(h.saveReply).not.toHaveBeenCalled();
  });

  it('generate returns 502 with a generic message on other LLM errors', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 4, comment: 'ok' });
    h.cfg.mockResolvedValue(null);
    h.gen.mockRejectedValue(new Error('secret upstream body'));
    const res = await generate(post(), ctx());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'LLM generation failed' });
  });

  it('approve posts the stored draft then saves POSTED/ADMIN_EDITED with Google metadata', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', source: 'gbp', reply: { text: 'draft text' } });
    h.post.mockResolvedValue({ moderationState: 'PENDING', policyViolation: null, reviewReplyUrl: 'https://g.page/x' });
    const res = await approve(post(), ctx());
    expect(h.post).toHaveBeenCalledWith('rest1', 'g1', 'draft text');
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'rv1', text: 'draft text', state: 'POSTED', source: 'ADMIN_EDITED',
      meta: { moderationState: 'PENDING', policyViolation: null, reviewReplyUrl: 'https://g.page/x' } }));
    expect(await res.json()).toEqual({ ok: true, moderationState: 'PENDING' });
    expect(h.audit).toHaveBeenCalledWith('reviews.reply.approve', 'rest1', expect.objectContaining({ entityId: 'rv1' }));
  });

  it('approve 404s when there is no draft', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', reply: null });
    expect((await approve(post(), ctx())).status).toBe(404);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('approve: a Google error is stored as FAILED with a safe message and returns 502', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: { text: 'draft text' } });
    h.post.mockRejectedValue(new h.GoogleApiError(500, 'Google is unavailable right now. Try again later.'));
    const res = await approve(post(), ctx());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Google is unavailable right now. Try again later.' });
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'FAILED', text: 'draft text', error: 'Google is unavailable right now. Try again later.' }));
  });

  it('approve: not connected → 409', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: { text: 'draft text' } });
    h.post.mockRejectedValue(new Error('Google Business not connected'));
    expect((await approve(post(), ctx())).status).toBe(409);
  });

  it('approve refuses (422) a stored draft that fails the safety filter, posting nothing', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: { text: 'Email us at owner@spice.in' } });
    const res = await approve(post(), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).issues[0].code).toBe('email');
    expect(h.post).not.toHaveBeenCalled();
    expect(h.saveReply).not.toHaveBeenCalled();
  });

  it('reply with no existing reply saves source MANUAL', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: null });
    const res = await reply(post({ text: 'hi' }), ctx());
    expect(h.post).toHaveBeenCalledWith('rest1', 'g1', 'hi');
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi', state: 'POSTED', source: 'MANUAL' }));
    expect(await res.json()).toEqual({ ok: true, moderationState: null });
    expect(h.audit).toHaveBeenCalledWith('reviews.reply.post', 'rest1', expect.objectContaining({ entityId: 'rv1' }));
  });

  it('reply with existing reply saves source ADMIN_EDITED', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: { text: 'old' } });
    await reply(post({ text: 'hi' }), ctx());
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ source: 'ADMIN_EDITED' }));
  });

  it('reply 400s without text and 404s on missing review', async () => {
    expect((await reply(post({}), ctx())).status).toBe(400);
    h.getReviewScoped.mockResolvedValue(null);
    expect((await reply(post({ text: 'hi' }), ctx())).status).toBe(404);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('reply blocks typed incentives (422) and never posts', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: null });
    const res = await reply(post({ text: 'Thanks! Here is a free dessert on your next visit.' }), ctx());
    expect(res.status).toBe(422);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('reply blocks the matched order code / rider name in public text', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: null, matchedOrderId: 'o1', matchConfidence: 0.9 });
    h.getOrderContext.mockResolvedValue(ORDER);
    const res = await reply(post({ text: 'Sorry Ravi was late with your food.' }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).issues[0].code).toBe('order');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('reply to a Places (read-only) review is rejected with 400', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'places:1', source: 'places', reply: null });
    expect((await reply(post({ text: 'Thanks!' }), ctx())).status).toBe(400);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('PUT saves a DRAFT without posting; 409 if already posted', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: null });
    expect((await saveDraft(put({ text: 'work in progress' }), ctx())).status).toBe(200);
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ state: 'DRAFT', source: 'MANUAL', text: 'work in progress' }));
    expect(h.post).not.toHaveBeenCalled();
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', reply: { state: 'POSTED' } });
    expect((await saveDraft(put({ text: 'x' }), ctx())).status).toBe(409);
  });
});

describe('order context route', () => {
  it('GET returns the stored match without private identifiers list', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', matchedOrderId: 'o1', matchConfidence: 0.9 });
    h.getOrderContext.mockResolvedValue(ORDER);
    const json = await (await orderCtx(new NextRequest('http://x'), ctx())).json();
    expect(json.match.code).toBe('ORD-AB12');
    expect(json.match.privateTerms).toBeUndefined();
    expect(h.matchAndStore).not.toHaveBeenCalled();
  });
  it('POST re-runs matching and audits; null when no match', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', reviewerName: 'Asha', reviewCreatedAt: new Date() });
    h.matchAndStore.mockResolvedValue(null);
    const json = await (await rematch(post(), ctx())).json();
    expect(json).toEqual({ match: null });
    expect(h.audit).toHaveBeenCalledWith('reviews.match.refresh', 'rest1', expect.anything());
  });
  it('404 for a foreign review', async () => {
    h.getReviewScoped.mockResolvedValue(null);
    expect((await orderCtx(new NextRequest('http://x'), ctx())).status).toBe(404);
  });
});
