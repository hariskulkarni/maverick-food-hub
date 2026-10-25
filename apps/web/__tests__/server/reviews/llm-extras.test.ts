import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getConfig: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));
vi.mock('@/server/log', () => ({ log: { info: h.info, warn: h.warn, error: h.error } }));

import { buildPrompt, analyzeReviewsBatch, generateReviewReply, LlmNotConfiguredError } from '@/server/reviews/llm';

const KEY = 'sk-ant-SECRET999';
const anthropic = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });

beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('buildPrompt extras', () => {
  it('adds voice, private context (marked never to mention) and rejection reason', () => {
    const p = buildPrompt(2, 'late', 'friendly', { voice: 'we; casual', privateContext: 'Biryani x1, 20 min late', rejectionReason: 'contact info' });
    expect(p).toContain('Owner tone notes: friendly');
    expect(p).toContain("usual reply style: we; casual");
    expect(p).toMatch(/PRIVATE CONTEXT .*NEVER mention.*Biryani x1, 20 min late/);
    expect(p).toContain('Google rejected the previous reply for: contact info');
    expect(p).toMatch(/Never offer discounts/);
  });
  it('omits empty extras', () => {
    const p = buildPrompt(5, null);
    expect(p).not.toContain('PRIVATE CONTEXT');
    expect(p).not.toContain('rejected');
  });
});

describe('generateReviewReply with extras', () => {
  it('sends the extras in the prompt', async () => {
    h.getConfig.mockResolvedValue({ provider: 'anthropic', apiKey: KEY, model: 'claude-haiku-5-5' });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropic('Thanks!'));
    await generateReviewReply({ restaurantId: 'r1', rating: 2, comment: 'cold', voice: 'we', privateContext: 'Dosa x2' });
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(body.messages[0].content).toContain('Dosa x2');
  });
});

describe('analyzeReviewsBatch', () => {
  const args = {
    restaurantId: 'r1', menu: ['Chicken Biryani', 'Masala Dosa'], issueTaxonomy: ['cold', 'late'] as const,
    reviews: [{ id: 'a', rating: 5, text: 'Biryani was great' }, { id: 'b', rating: 1, text: 'cold dosa' }],
  };
  it('throws LlmNotConfiguredError without a key (caller falls back)', async () => {
    h.getConfig.mockResolvedValue(null);
    await expect(analyzeReviewsBatch(args)).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });
  it('parses the JSON array and keeps only known ids, menu dishes and taxonomy issues', async () => {
    h.getConfig.mockResolvedValue({ provider: 'anthropic', apiKey: KEY, model: 'm' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropic('Here you go: ' + JSON.stringify([
      { id: 'a', sentiment: 'positive', issues: ['tasty'], dishes: [{ name: 'chicken biryani', sentiment: 'positive' }, { name: 'Pizza', sentiment: 'positive' }] },
      { id: 'b', sentiment: 'angry', issues: ['cold', 'late', 'bogus'], dishes: [{ name: 'Masala Dosa', sentiment: 'negative' }] },
      { id: 'zzz', sentiment: 'positive', issues: [], dishes: [] },
    ])));
    const out = await analyzeReviewsBatch(args);
    expect(out).toEqual([
      { id: 'a', sentiment: 'positive', issues: [], dishes: [{ name: 'Chicken Biryani', sentiment: 'positive' }] },
      { id: 'b', sentiment: 'neutral', issues: ['cold', 'late'], dishes: [{ name: 'Masala Dosa', sentiment: 'negative' }] },
    ]);
  });
  it('throws on a non-JSON answer and never leaks the key in logs', async () => {
    h.getConfig.mockResolvedValue({ provider: 'openai', apiKey: KEY, model: 'm' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'sorry, no' } }] }), { status: 200 }));
    await expect(analyzeReviewsBatch(args)).rejects.toThrow(/no JSON array/);
    for (const c of [...h.info.mock.calls, ...h.warn.mock.calls, ...h.error.mock.calls]) expect(JSON.stringify(c)).not.toContain(KEY);
  });
  it('returns [] for an empty batch without calling the provider', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await analyzeReviewsBatch({ ...args, reviews: [] })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
