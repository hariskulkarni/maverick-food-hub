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

const LLM_TIMEOUT_MS = 20000;

export type ReplyPromptExtras = {
  /** Style summary learned from the restaurant's own posted replies. */
  voice?: string | null;
  /** PRIVATE order context for the model only (never to be echoed publicly). */
  privateContext?: string | null;
  /** Why Google rejected the previous reply, when redrafting. */
  rejectionReason?: string | null;
};

export function buildPrompt(rating: number, comment: string | null, tone?: string | null, extras: ReplyPromptExtras = {}): string {
  return [
    'You write a short, warm, professional reply from a restaurant to a Google review.',
    'Rules: 1-3 sentences; thank the reviewer by sentiment not name; never invent facts, offers, or refunds;',
    'for low ratings apologise sincerely and invite them to make it right; no hashtags; no emojis unless the review used them.',
    'Never offer discounts, freebies or anything in exchange for a review, never ask them to change or remove the review,',
    'and never include phone numbers, email addresses, order numbers, rider names, delivery times or other personal details.',
    tone ? `Owner tone notes: ${tone}` : '',
    extras.voice ? `Match the restaurant's usual reply style: ${extras.voice}` : '',
    extras.privateContext
      ? `PRIVATE CONTEXT (for understanding only, NEVER mention or hint at any of it in the reply): ${extras.privateContext}`
      : '',
    extras.rejectionReason
      ? `Google rejected the previous reply for: ${extras.rejectionReason}. Write a new reply that clearly complies.`
      : '',
    `Review rating: ${rating}/5.`,
    `Review text: ${comment?.trim() || '(no text, rating only)'}`,
    'Write only the reply text.',
  ].filter(Boolean).join('\n');
}

// Mask the key in the FULL body before truncating, so a cut inside an echoed key can't leak a prefix.
async function safeBody(res: Response, apiKey: string): Promise<string> {
  const raw = await res.text();
  return (apiKey ? raw.split(apiKey).join('***') : raw).slice(0, 200);
}

async function callAnthropic(apiKey: string, model: string, prompt: string, maxTokens = 300): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await safeBody(res, apiKey)}`);
  const data = await res.json();
  const text = Array.isArray(data?.content) ? data.content.find((b: any) => b.type === 'text')?.text : '';
  if (!text) throw new Error('anthropic: empty response');
  return String(text).trim();
}

async function callOpenAiCompat(base: string, apiKey: string, model: string, prompt: string, maxTokens = 300): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${await safeBody(res, apiKey)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('llm: empty response');
  return String(text).trim();
}

async function callProvider(provider: LlmProvider, apiKey: string, model: string, prompt: string, maxTokens = 300): Promise<string> {
  try {
    if (provider === 'anthropic') return await callAnthropic(apiKey, model, prompt, maxTokens);
    return await callOpenAiCompat(OPENAI_COMPAT_BASE[provider], apiKey, model, prompt, maxTokens);
  } catch (e: any) {
    // Provider error bodies can echo the submitted key; never let it escape.
    const msg = String(e?.message ?? 'LLM call failed');
    throw new Error(apiKey ? msg.split(apiKey).join('***') : msg);
  }
}

async function resolveKey(restaurantId: string): Promise<{ provider: LlmProvider; apiKey: string; model: string }> {
  const cfg = await getConfig(restaurantId, 'LLM_REVIEWS' as any);
  if (!cfg?.apiKey || !cfg?.provider) throw new LlmNotConfiguredError();
  if (!Object.prototype.hasOwnProperty.call(LLM_MODELS, cfg.provider)) throw new LlmNotConfiguredError();
  const provider = cfg.provider as LlmProvider;
  return { provider, apiKey: cfg.apiKey, model: cfg.model || LLM_MODELS[provider][0].value };
}

export async function generateReviewReply(args: {
  restaurantId: string; rating: number; comment: string | null; tone?: string | null;
} & ReplyPromptExtras): Promise<{ text: string; provider: LlmProvider; model: string }> {
  const { provider, apiKey, model } = await resolveKey(args.restaurantId);
  const prompt = buildPrompt(args.rating, args.comment, args.tone, {
    voice: args.voice, privateContext: args.privateContext, rejectionReason: args.rejectionReason,
  });
  const text = await callProvider(provider, apiKey, model, prompt);
  log.info({ restaurantId: args.restaurantId, provider, model, rating: args.rating }, 'reviews.llm.generated');
  return { text, provider, model };
}

export type ReviewTopics = {
  id: string; sentiment: 'positive' | 'neutral' | 'negative'; issues: string[];
  dishes: Array<{ name: string; sentiment: 'positive' | 'neutral' | 'negative' }>;
};

const SENTIMENTS = new Set(['positive', 'neutral', 'negative']);

/**
 * Topic + sentiment extraction for a batch of reviews using this restaurant's
 * own key. Output is validated: dishes must come from `menu`, issues from
 * `issueTaxonomy`; anything else is dropped. Throws LlmNotConfiguredError when
 * there is no key (callers fall back to the keyword analyser).
 */
export async function analyzeReviewsBatch(args: {
  restaurantId: string;
  reviews: Array<{ id: string; rating: number; text: string }>;
  menu: string[];
  issueTaxonomy: readonly string[];
}): Promise<ReviewTopics[]> {
  if (args.reviews.length === 0) return [];
  const { provider, apiKey, model } = await resolveKey(args.restaurantId);
  const prompt = [
    'Classify each restaurant review. Return ONLY a JSON array, one object per review:',
    '{"id": string, "sentiment": "positive"|"neutral"|"negative", "issues": string[], "dishes": [{"name": string, "sentiment": "positive"|"neutral"|"negative"}]}',
    `Allowed issues (use only these): ${args.issueTaxonomy.join(', ')}.`,
    `Allowed dish names (use the exact name, only when the review clearly mentions it): ${args.menu.slice(0, 150).join(' | ') || '(none)'}.`,
    'Reviews:',
    JSON.stringify(args.reviews.map((r) => ({ id: r.id, rating: r.rating, text: r.text.slice(0, 800) }))),
  ].join('\n');
  const raw = await callProvider(provider, apiKey, model, prompt, 2000);
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('llm: no JSON array in analysis');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('llm: analysis is not an array');
  const ids = new Set(args.reviews.map((r) => r.id));
  const menuByLower = new Map(args.menu.map((m) => [m.toLowerCase(), m]));
  const issues = new Set(args.issueTaxonomy);
  const sent = (v: unknown) => (SENTIMENTS.has(String(v)) ? String(v) : 'neutral') as ReviewTopics['sentiment'];
  log.info({ restaurantId: args.restaurantId, provider, model, n: args.reviews.length }, 'reviews.llm.analyzed');
  return parsed
    .filter((o: any) => o && ids.has(String(o.id)))
    .map((o: any) => ({
      id: String(o.id),
      sentiment: sent(o.sentiment),
      issues: (Array.isArray(o.issues) ? o.issues : []).map(String).filter((x: string) => issues.has(x)),
      dishes: (Array.isArray(o.dishes) ? o.dishes : [])
        .map((d: any) => ({ name: menuByLower.get(String(d?.name ?? '').toLowerCase()), sentiment: sent(d?.sentiment) }))
        .filter((d: any): d is { name: string; sentiment: ReviewTopics['sentiment'] } => !!d.name),
    }));
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
