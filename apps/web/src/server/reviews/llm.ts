/**
 * LLM adapter for Google-review replies. SOLE CONSUMER of the LLM_REVIEWS key:
 * the key is fetched from the encrypted integration store INSIDE this module,
 * used once to call the provider, and never returned, logged, or exported. No
 * other feature may import this module to borrow the key — that is the
 * "only this segment and nothing else" guarantee from the spec.
 *
 * All three providers are called over fetch (no SDK dependency). OpenAI and
 * NVIDIA share the OpenAI-compatible chat/completions shape; NVIDIA differs
 * only by base URL.
 */
import { getConfig } from '@/server/integrations';
import { log } from '@/server/log';

export type LlmProvider = 'anthropic' | 'openai' | 'nvidia';

export class LlmNotConfiguredError extends Error {
  constructor() { super('No LLM key configured for this restaurant'); this.name = 'LlmNotConfiguredError'; }
}

export const LLM_MODELS: Record<LlmProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fast, cheap)' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ],
  nvidia: [
    { value: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (free)' },
    { value: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B (free, fastest)' },
  ],
};

const OPENAI_COMPAT_BASE: Record<'openai' | 'nvidia', string> = {
  openai: 'https://api.openai.com/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
};

function buildPrompt(rating: number, comment: string | null, tone?: string | null): string {
  return [
    'You write a short, warm, professional reply from a restaurant to a Google review.',
    'Rules: 1-3 sentences; thank the reviewer by sentiment not name; never invent facts, offers, or refunds;',
    'for low ratings apologise sincerely and invite them to make it right; no hashtags; no emojis unless the review used them.',
    tone ? `Brand voice: ${tone}` : '',
    `Review rating: ${rating}/5.`,
    `Review text: ${comment?.trim() || '(no text, rating only)'}`,
    'Write only the reply text.',
  ].filter(Boolean).join('\n');
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = Array.isArray(data?.content) ? data.content.find((b: any) => b.type === 'text')?.text : '';
  if (!text) throw new Error('anthropic: empty response');
  return String(text).trim();
}

async function callOpenAiCompat(base: string, apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('llm: empty response');
  return String(text).trim();
}

async function callProvider(provider: LlmProvider, apiKey: string, model: string, prompt: string): Promise<string> {
  if (provider === 'anthropic') return callAnthropic(apiKey, model, prompt);
  return callOpenAiCompat(OPENAI_COMPAT_BASE[provider], apiKey, model, prompt);
}

export async function generateReviewReply(args: {
  restaurantId: string; rating: number; comment: string | null; tone?: string | null;
}): Promise<{ text: string; provider: LlmProvider; model: string }> {
  const cfg = await getConfig(args.restaurantId, 'LLM_REVIEWS' as any);
  if (!cfg?.apiKey || !cfg?.provider) throw new LlmNotConfiguredError();
  const provider = cfg.provider as LlmProvider;
  const model = cfg.model || LLM_MODELS[provider][0].value;
  const prompt = buildPrompt(args.rating, args.comment, args.tone);
  const text = await callProvider(provider, cfg.apiKey, model, prompt);
  log.info('reviews.llm.generated', { restaurantId: args.restaurantId, provider, model, rating: args.rating });
  return { text, provider, model };
}

export async function testLlmKey(cfg: { provider: LlmProvider; apiKey: string; model: string }):
  Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    const text = await callProvider(cfg.provider, cfg.apiKey, cfg.model, 'Reply with the single word: ok');
    return { ok: true, detail: `Model responded (${text.slice(0, 40)})` };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message).slice(0, 200) : 'LLM test failed' };
  }
}
