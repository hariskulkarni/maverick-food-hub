import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('@/server/integrations', () => ({ getConfig: getConfigMock }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateReviewReply, testLlmKey, LlmNotConfiguredError } from '@/server/reviews/llm';

beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('generateReviewReply', () => {
  it('throws LlmNotConfiguredError when no key is stored', async () => {
    getConfigMock.mockResolvedValue(null);
    await expect(generateReviewReply({ restaurantId: 'r1', rating: 5, comment: 'Great!' }))
      .rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it('calls Anthropic and returns the generated text', async () => {
    getConfigMock.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-ant-xxx', model: 'claude-haiku-5-5' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'Thank you so much!' }] }), { status: 200 }),
    );
    const out = await generateReviewReply({ restaurantId: 'r1', rating: 5, comment: 'Great!' });
    expect(out).toEqual({ text: 'Thank you so much!', provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    // key is sent to the provider but never returned to the caller
    expect(JSON.stringify(out)).not.toContain('sk-ant-xxx');
  });

  it('calls NVIDIA via the OpenAI-compatible endpoint', async () => {
    getConfigMock.mockResolvedValue({ provider: 'nvidia', apiKey: 'nvapi-xxx', model: 'meta/llama-3.1-70b-instruct' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'We appreciate your feedback.' } }] }), { status: 200 }),
    );
    const out = await generateReviewReply({ restaurantId: 'r1', rating: 2, comment: 'Slow service' });
    expect(out.text).toBe('We appreciate your feedback.');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
  });

  it('testLlmKey returns ok:false with error on a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const r = await testLlmKey({ provider: 'openai', apiKey: 'sk-bad', model: 'gpt-4o-mini' });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
