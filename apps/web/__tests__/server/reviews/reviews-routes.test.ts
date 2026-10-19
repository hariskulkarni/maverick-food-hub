import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(), getReviewScoped: vi.fn(), saveReply: vi.fn(),
  listForAdmin: vi.fn(), gen: vi.fn(), post: vi.fn(), cfg: vi.fn(),
  LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/reviews/store', () => ({
  getReviewScoped: h.getReviewScoped, saveReply: h.saveReply,
  listReviewsForAdmin: h.listForAdmin, getAutoReplyConfig: h.cfg,
}));
vi.mock('@/server/reviews/llm', () => ({ generateReviewReply: h.gen, LlmNotConfiguredError: h.LlmNotConfiguredError }));
vi.mock('@/server/reviews/google-business', () => ({ postReply: h.post }));

import { GET } from '@/app/api/admin/reviews/route';
import { POST as generate } from '@/app/api/admin/reviews/[id]/generate/route';
import { POST as approve } from '@/app/api/admin/reviews/[id]/approve/route';
import { POST as reply } from '@/app/api/admin/reviews/[id]/reply/route';

const ctx = (id = 'rv1') => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
});

describe('admin reviews routes', () => {
  it('GET lists scoped, returns DTO only with no secrets', async () => {
    h.listForAdmin.mockResolvedValue([{
      id: 'rv1', reviewerName: 'Ann', rating: 5, comment: 'great', reviewCreatedAt: new Date('2026-01-01'),
      googleReviewId: 'g1', restaurantId: 'rest1', apiKey: 'sekret', refreshToken: 'rt', configEncrypted: 'enc',
      reply: { state: 'POSTED', text: 'thanks', source: 'AUTO', postedAt: new Date('2026-01-02'), llmModel: 'm', error: null },
    }]);
    const res = await GET(new NextRequest('http://localhost/api/admin/reviews'));
    expect(h.listForAdmin).toHaveBeenCalledWith('rest1', expect.anything());
    const json = await res.json();
    const s = JSON.stringify(json);
    expect(s).not.toContain('apiKey');
    expect(s).not.toContain('refreshToken');
    expect(s).not.toContain('configEncrypted');
    expect(Object.keys(json.reviews[0]).sort()).toEqual(
      ['comment', 'id', 'rating', 'reply', 'reviewCreatedAt', 'reviewerName']);
    expect(Object.keys(json.reviews[0].reply).sort()).toEqual(['postedAt', 'source', 'state', 'text']);
  });

  it('generate returns 404 for unknown/foreign review and does not call LLM', async () => {
    h.getReviewScoped.mockResolvedValue(null);
    const res = await generate(post(), ctx());
    expect(res.status).toBe(404);
    expect(h.getReviewScoped).toHaveBeenCalledWith('rest1', 'rv1');
    expect(h.gen).not.toHaveBeenCalled();
  });

  it('generate saves a PENDING_APPROVAL draft', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', rating: 4, comment: 'ok' });
    h.cfg.mockResolvedValue({ tonePrompt: 'warm' });
    h.gen.mockResolvedValue({ text: 'draft', provider: 'p', model: 'm' });
    const res = await generate(post(), ctx());
    expect(h.gen).toHaveBeenCalledWith({ restaurantId: 'rest1', rating: 4, comment: 'ok', tone: 'warm' });
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'rv1', restaurantId: 'rest1', text: 'draft', state: 'PENDING_APPROVAL', source: 'AUTO' }));
    expect(await res.json()).toEqual({ ok: true, text: 'draft' });
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

  it('approve posts the stored draft then saves POSTED/ADMIN_EDITED', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: { text: 'draft text' } });
    const res = await approve(post(), ctx());
    expect(h.post).toHaveBeenCalledWith('rest1', 'g1', 'draft text');
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'rv1', text: 'draft text', state: 'POSTED', source: 'ADMIN_EDITED' }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('approve 404s when there is no draft', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', reply: null });
    expect((await approve(post(), ctx())).status).toBe(404);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('reply with no existing reply saves source MANUAL', async () => {
    h.getReviewScoped.mockResolvedValue({ id: 'rv1', googleReviewId: 'g1', reply: null });
    const res = await reply(post({ text: 'hi' }), ctx());
    expect(h.post).toHaveBeenCalledWith('rest1', 'g1', 'hi');
    expect(h.saveReply).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi', state: 'POSTED', source: 'MANUAL' }));
    expect(await res.json()).toEqual({ ok: true });
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
});
