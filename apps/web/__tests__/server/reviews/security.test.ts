import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  listForRestaurant: vi.fn(),
  requireManagedRestaurant: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig, listForRestaurant: h.listForRestaurant }));
vi.mock('@/server/log', () => ({ log: { info: h.info, warn: h.warn, error: h.error } }));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/reviews/review-audit', () => ({ auditReview: vi.fn() }));
vi.mock('@/server/db', () => ({
  prisma: { reviewAutoReplyConfig: { upsert: h.upsert, findUnique: h.findUnique } },
}));

import { generateReviewReply, testLlmKey, LlmNotConfiguredError } from '@/server/reviews/llm';
import { GET } from '@/app/api/admin/reviews/config/route';

const KEY = 'sk-ant-SECRET123';
const ok = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Thanks!' }] }), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('reviews security', () => {
  it('generateReviewReply result never contains the api key', async () => {
    h.getConfig.mockResolvedValue({ provider: 'anthropic', apiKey: KEY, model: 'claude-haiku-5-5' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    const out = await generateReviewReply({ restaurantId: 'r1', rating: 5, comment: 'Great' });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('no log call receives the api key', async () => {
    h.getConfig.mockResolvedValue({ provider: 'anthropic', apiKey: KEY, model: 'claude-haiku-5-5' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await generateReviewReply({ restaurantId: 'r1', rating: 5, comment: 'Great' });
    const calls = [...h.info.mock.calls, ...h.warn.mock.calls, ...h.error.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(JSON.stringify(args)).not.toContain(KEY);
  });

  it('testLlmKey masks a key echoed back by the provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('x'.repeat(190) + KEY + 'tail', { status: 401 }));
    for (const provider of ['anthropic', 'openai'] as const) {
      const r = await testLlmKey({ provider, apiKey: KEY, model: 'm' });
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
      expect(r.error).not.toContain(KEY);
      for (let i = 0; i + 8 <= KEY.length; i++) {
        for (let j = i + 8; j <= KEY.length; j++) expect(r.error).not.toContain(KEY.slice(i, j));
      }
    }
  });

  it('passes an abort signal to every provider fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }], choices: [{ message: { content: 'x' } }] }), { status: 200 }));
    await testLlmKey({ provider: 'anthropic', apiKey: KEY, model: 'm' });
    await testLlmKey({ provider: 'nvidia', apiKey: KEY, model: 'm' });
    for (const c of spy.mock.calls) expect((c[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an unknown stored provider with LlmNotConfiguredError', async () => {
    h.getConfig.mockResolvedValue({ provider: 'bogus', apiKey: KEY });
    await expect(generateReviewReply({ restaurantId: 'r1', rating: 5, comment: null }))
      .rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it('GET /api/admin/reviews/config never exposes secrets', async () => {
    h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
    h.listForRestaurant.mockResolvedValue([
      { provider: 'GOOGLE_BUSINESS', status: 'CONNECTED', summary: { accountId: 'a1', locationId: 'l1' } },
      { provider: 'LLM_REVIEWS', status: 'CONNECTED', summary: { provider: 'anthropic', apiKey: '••••T123', model: 'm' } },
    ]);
    h.findUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://x/api/admin/reviews/config'));
    const s = JSON.stringify(await res.json());
    expect(s).not.toContain('refreshToken');
    expect(s).not.toContain('configEncrypted');
    expect(s).not.toContain('sk-ant-');
    const body = JSON.parse(s);
    expect(Object.keys(body).sort()).toEqual(['autoPublishReviews', 'autoReply', 'google', 'llm', 'places']);
    expect(Object.keys(body.places).sort()).toEqual(['configured', 'connected', 'name']);
    expect(Object.keys(body.google).sort()).toEqual(['status', 'summary']);
    expect(Object.keys(body.llm).sort()).toEqual(['status', 'summary']);
    expect(body.llm.summary).toEqual({ provider: 'anthropic', apiKey: '••••T123', model: 'm' });
    expect(body.google.summary).toEqual({ accountId: 'a1', locationId: 'l1' });
    expect(h.getConfig).not.toHaveBeenCalled();
  });
});
