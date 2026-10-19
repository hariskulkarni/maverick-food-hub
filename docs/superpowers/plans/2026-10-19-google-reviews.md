# Google Reviews Integration Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a restaurant admin connect Google Business Profile, view their Google reviews, and reply manually or via an LLM that auto-posts to 4–5★ reviews and drafts replies to 1–3★ reviews for approval.

**Architecture:** Secrets (Google OAuth refresh token, LLM key) reuse the existing per-restaurant AES-256-GCM `IntegrationCredential` store. New Prisma tables hold reviews, replies, and per-restaurant auto-reply config. Google + LLM adapters are `fetch`-based (no new deps) behind narrow interfaces; one LLM module is the sole consumer of the LLM key. A cron-triggered sweep job syncs reviews and applies the rating policy.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/PostgreSQL, vitest. Google Business Profile API (REST), Anthropic/OpenAI/NVIDIA chat APIs (REST via fetch).

**Spec:** `docs/superpowers/specs/2026-10-19-google-reviews-design.md`

## Global Constraints

- **No new runtime dependencies.** All HTTP to Google/LLMs uses the global `fetch`, mirroring `src/server/msg91-widget.ts`. Mock `fetch` in tests.
- **Secrets never reach the client.** API responses and logs expose only masked summaries (`maskSecret`, `…last4`) — never `apiKey` or `refreshToken`. Decryption happens only inside the server adapter that uses the secret.
- **Tenant isolation, fail-closed.** Every Prisma query predicate carries `restaurantId`. Admin endpoints resolve the caller's restaurant and scope to it; a cross-tenant id returns zero rows.
- **Encryption key:** secrets go through `encryptJSON`/`decryptJSON` from `src/server/crypto.ts` (AES-256-GCM, `INTEGRATION_ENCRYPTION_KEY`). Never add a second crypto path.
- **Commit after every passing task.** Attribution footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TE5Smmr59myK3uRDYyqYbW
  ```
- **Branch:** `feat/google-reviews` (already created). Do not deploy; do not run against real Google/LLM accounts during implementation.
- **Test command:** `cd apps/web && npx vitest run <path>` (unit). Lint/typecheck: `cd apps/web && npm run lint && npx tsc --noEmit`.
- **Paths** are relative to repo root `apps/web/` unless absolute.

---

### Task 1: Prisma schema — enums, models, relations, migration

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (enum `IntegrationProvider` ~line 132; `Restaurant` relations ~line 512; append new models near `IntegrationCredential` ~line 2282)
- Test: `apps/web/__tests__/server/reviews/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `GoogleReview`, `ReviewReply`, `ReviewAutoReplyConfig`; enums `ReviewReplyState` (`DRAFT|PENDING_APPROVAL|POSTED|FAILED|SKIPPED`), `ReviewReplySource` (`AUTO|MANUAL|ADMIN_EDITED`); `IntegrationProvider` values `GOOGLE_BUSINESS`, `LLM_REVIEWS`.

- [ ] **Step 1: Add the two enum values** to `enum IntegrationProvider` in `schema.prisma`:

```prisma
  // Google Business Profile OAuth (refresh token + accountId + locationId).
  GOOGLE_BUSINESS
  // LLM key for Google-review auto-reply (provider=anthropic|openai|nvidia + apiKey + model).
  LLM_REVIEWS
```

- [ ] **Step 2: Append new enums + models** at the end of `schema.prisma`:

```prisma
enum ReviewReplyState { DRAFT PENDING_APPROVAL POSTED FAILED SKIPPED }
enum ReviewReplySource { AUTO MANUAL ADMIN_EDITED }

model GoogleReview {
  id              String   @id @default(cuid())
  restaurantId    String
  googleReviewId  String   @unique
  reviewerName    String?
  rating          Int
  comment         String?
  reviewCreatedAt DateTime
  syncedAt        DateTime @default(now())
  reply           ReviewReply?
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId, reviewCreatedAt])
  @@index([restaurantId, rating])
}

model ReviewReply {
  id           String   @id @default(cuid())
  reviewId     String   @unique
  restaurantId String
  state        ReviewReplyState  @default(DRAFT)
  text         String
  source       ReviewReplySource
  llmProvider  String?
  llmModel     String?
  postedAt     DateTime?
  error        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  review       GoogleReview @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  @@index([restaurantId, state])
}

model ReviewAutoReplyConfig {
  id                String   @id @default(cuid())
  restaurantId      String   @unique
  enabled           Boolean  @default(false)
  autoPostMinRating Int      @default(4)
  draftMaxRating    Int      @default(3)
  tonePrompt        String?
  updatedAt         DateTime @updatedAt
  restaurant        Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Add relations to `model Restaurant`** (next to `integrations IntegrationCredential[]`):

```prisma
  googleReviews       GoogleReview[]
  reviewReplies       ReviewReply[]
  reviewAutoReplyCfg  ReviewAutoReplyConfig?
```

- [ ] **Step 4: Validate + generate client**

Run: `cd apps/web && npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and client regenerates.

- [ ] **Step 5: Apply to the dev/test database** using the repo's existing strategy (db push — matches prod/demo per audit note H29):

Run: `cd apps/web && npx prisma db push`
Expected: tables `GoogleReview`, `ReviewReply`, `ReviewAutoReplyConfig` created.

- [ ] **Step 6: Write a schema smoke test** `__tests__/server/reviews/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

describe('reviews schema', () => {
  it('exposes the new models and enum values on the Prisma client', () => {
    expect(Prisma.ModelName.GoogleReview).toBe('GoogleReview');
    expect(Prisma.ModelName.ReviewReply).toBe('ReviewReply');
    expect(Prisma.ModelName.ReviewAutoReplyConfig).toBe('ReviewAutoReplyConfig');
    expect(Prisma.ReviewReplyState.PENDING_APPROVAL).toBe('PENDING_APPROVAL');
    expect(Prisma.ReviewReplySource.AUTO).toBe('AUTO');
    expect(Prisma.IntegrationProvider.GOOGLE_BUSINESS).toBe('GOOGLE_BUSINESS');
    expect(Prisma.IntegrationProvider.LLM_REVIEWS).toBe('LLM_REVIEWS');
  });
});
```

- [ ] **Step 7: Run the test**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/__tests__/server/reviews/schema.test.ts
git commit -m "feat(reviews): schema for Google reviews, replies, auto-reply config"
```

---

### Task 2: Policy engine (pure)

**Files:**
- Create: `apps/web/src/server/reviews/policy.ts`
- Test: `apps/web/__tests__/server/reviews/policy.test.ts`

**Interfaces:**
- Consumes: `ReviewAutoReplyConfig` fields (`enabled`, `autoPostMinRating`, `draftMaxRating`).
- Produces: `type ReplyDecision = 'AUTO_POST' | 'DRAFT' | 'SKIP'`; `function decideReplyAction(rating: number, cfg: { enabled: boolean; autoPostMinRating: number; draftMaxRating: number } | null): ReplyDecision`.

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { decideReplyAction } from '@/server/reviews/policy';

const cfg = { enabled: true, autoPostMinRating: 4, draftMaxRating: 3 };

describe('decideReplyAction', () => {
  it('auto-posts at or above autoPostMinRating', () => {
    expect(decideReplyAction(5, cfg)).toBe('AUTO_POST');
    expect(decideReplyAction(4, cfg)).toBe('AUTO_POST');
  });
  it('drafts at or below draftMaxRating', () => {
    expect(decideReplyAction(3, cfg)).toBe('DRAFT');
    expect(decideReplyAction(1, cfg)).toBe('DRAFT');
  });
  it('skips when disabled', () => {
    expect(decideReplyAction(5, { ...cfg, enabled: false })).toBe('SKIP');
  });
  it('skips when no config', () => {
    expect(decideReplyAction(5, null)).toBe('SKIP');
  });
  it('skips a rating that falls in the gap between thresholds', () => {
    // autoPostMinRating 5, draftMaxRating 3 → rating 4 is neither
    expect(decideReplyAction(4, { enabled: true, autoPostMinRating: 5, draftMaxRating: 3 })).toBe('SKIP');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '@/server/reviews/policy'`).

Run: `cd apps/web && npx vitest run __tests__/server/reviews/policy.test.ts`

- [ ] **Step 3: Implement** `src/server/reviews/policy.ts`:

```typescript
/**
 * Pure rating-gate for Google-review auto-reply. No I/O.
 *   rating >= autoPostMinRating  → AUTO_POST
 *   rating <= draftMaxRating     → DRAFT (held for admin approval)
 *   otherwise / disabled / no cfg → SKIP
 */
export type ReplyDecision = 'AUTO_POST' | 'DRAFT' | 'SKIP';

export function decideReplyAction(
  rating: number,
  cfg: { enabled: boolean; autoPostMinRating: number; draftMaxRating: number } | null,
): ReplyDecision {
  if (!cfg || !cfg.enabled) return 'SKIP';
  if (rating >= cfg.autoPostMinRating) return 'AUTO_POST';
  if (rating <= cfg.draftMaxRating) return 'DRAFT';
  return 'SKIP';
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/policy.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/reviews/policy.ts apps/web/__tests__/server/reviews/policy.test.ts
git commit -m "feat(reviews): pure rating-gate policy engine"
```

---

### Task 3: LLM adapter — sole consumer of the LLM key

**Files:**
- Create: `apps/web/src/server/reviews/llm.ts`
- Test: `apps/web/__tests__/server/reviews/llm.test.ts`

**Interfaces:**
- Consumes: `getConfig(restaurantId, 'LLM_REVIEWS')` from `@/server/integrations` → `{ provider, apiKey, model } | null`.
- Produces:
  - `type LlmProvider = 'anthropic' | 'openai' | 'nvidia'`
  - `const LLM_MODELS: Record<LlmProvider, { value: string; label: string }[]>`
  - `async function generateReviewReply(args: { restaurantId: string; rating: number; comment: string | null; tone?: string | null }): Promise<{ text: string; provider: LlmProvider; model: string }>` — throws `LlmNotConfiguredError` when no key.
  - `async function testLlmKey(cfg: { provider: LlmProvider; apiKey: string; model: string }): Promise<{ ok: boolean; detail?: string; error?: string }>`
  - `class LlmNotConfiguredError extends Error`

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/llm.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

Run: `cd apps/web && npx vitest run __tests__/server/reviews/llm.test.ts`

- [ ] **Step 3: Implement** `src/server/reviews/llm.ts`:

```typescript
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
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/llm.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/reviews/llm.ts apps/web/__tests__/server/reviews/llm.test.ts
git commit -m "feat(reviews): fetch-based LLM adapter (anthropic/openai/nvidia), single key consumer"
```

---

### Task 4: Google Business Profile adapter

**Files:**
- Create: `apps/web/src/server/reviews/google-business.ts`
- Test: `apps/web/__tests__/server/reviews/google-business.test.ts`

**Interfaces:**
- Consumes: `getConfig`/`saveConfig` from `@/server/integrations`; `encryptJSON`/`decryptJSON` not used directly (the store handles it). Env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.
- Produces:
  - `function getOAuthUrl(state: string): string`
  - `async function exchangeCode(code: string): Promise<{ refreshToken: string }>`
  - `async function listReviews(restaurantId: string): Promise<NormalizedReview[]>` where `type NormalizedReview = { googleReviewId: string; reviewerName: string | null; rating: number; comment: string | null; reviewCreatedAt: Date }`
  - `async function postReply(restaurantId: string, googleReviewId: string, text: string): Promise<void>`
  - `const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage'`

Notes for implementer: Google maps star ratings as enum strings `ONE..FIVE`; `starToInt` converts. `googleReviewId` is the full review resource name (`accounts/{a}/locations/{l}/reviews/{r}`). Access token is fetched fresh from the refresh token on each sweep (sweep runs every few minutes; caching is optional and omitted for simplicity — YAGNI).

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/google-business.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('@/server/integrations', () => ({ getConfig: getConfigMock, saveConfig: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getOAuthUrl, listReviews, postReply, GOOGLE_SCOPE } from '@/server/reviews/google-business';

beforeEach(() => {
  vi.clearAllMocks(); vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://flavrly.in/api/admin/integrations/google-business/callback';
  getConfigMock.mockResolvedValue({ refreshToken: 'rt', accountId: 'accounts/1', locationId: 'locations/2' });
});

describe('getOAuthUrl', () => {
  it('includes scope, client id, offline access, and state', () => {
    const url = getOAuthUrl('st8');
    expect(url).toContain('scope=' + encodeURIComponent(GOOGLE_SCOPE));
    expect(url).toContain('client_id=cid');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('state=st8');
  });
});

describe('listReviews', () => {
  it('maps STAR enum to int and returns normalized reviews', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reviews: [{
        name: 'accounts/1/locations/2/reviews/9', reviewer: { displayName: 'Asha' },
        starRating: 'FIVE', comment: 'Loved it', createTime: '2026-10-18T10:00:00Z',
      }] }), { status: 200 }));
    const out = await listReviews('r1');
    expect(out).toEqual([{
      googleReviewId: 'accounts/1/locations/2/reviews/9', reviewerName: 'Asha',
      rating: 5, comment: 'Loved it', reviewCreatedAt: new Date('2026-10-18T10:00:00Z'),
    }]);
  });
});

describe('postReply', () => {
  it('PUTs the reply to the review resource', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comment: 'thanks' }), { status: 200 }));
    await postReply('r1', 'accounts/1/locations/2/reviews/9', 'Thank you!');
    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('/accounts/1/locations/2/reviews/9/reply');
    expect(init?.method).toBe('PUT');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/google-business.test.ts`

- [ ] **Step 3: Implement** `src/server/reviews/google-business.ts`:

```typescript
/**
 * Google Business Profile adapter (read reviews + post replies) over fetch.
 *
 * Auth model: OAuth 2.0 with the business owner's consent (scope
 * business.manage). We persist only the refresh token (encrypted, via the
 * IntegrationCredential store); access tokens are short-lived and fetched on
 * demand — never persisted in plaintext.
 *
 * Reviews + replies use the Google My Business v4 reviews surface:
 *   GET  https://mybusiness.googleapis.com/v4/{location}/reviews
 *   PUT  https://mybusiness.googleapis.com/v4/{review}/reply   { comment }
 */
import { getConfig } from '@/server/integrations';
import { log } from '@/server/log';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MBAPI = 'https://mybusiness.googleapis.com/v4';

export type NormalizedReview = {
  googleReviewId: string; reviewerName: string | null; rating: number;
  comment: string | null; reviewCreatedAt: Date;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getOAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: env('GOOGLE_OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_OAUTH_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.refresh_token) throw new Error('google: no refresh_token (re-consent with prompt=consent)');
  return { refreshToken: data.refresh_token };
}

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token as string;
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function cfgOrThrow(restaurantId: string) {
  const cfg = await getConfig(restaurantId, 'GOOGLE_BUSINESS' as any);
  if (!cfg?.refreshToken || !cfg?.locationId) throw new Error('Google Business not connected');
  return cfg as { refreshToken: string; accountId: string; locationId: string };
}

export async function listReviews(restaurantId: string): Promise<NormalizedReview[]> {
  const cfg = await cfgOrThrow(restaurantId);
  const token = await accessToken(cfg.refreshToken);
  const res = await fetch(`${MBAPI}/${cfg.locationId}/reviews`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google reviews ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  return reviews.map((r: any) => ({
    googleReviewId: String(r.name),
    reviewerName: r.reviewer?.displayName ?? null,
    rating: STAR[r.starRating] ?? 0,
    comment: r.comment ?? null,
    reviewCreatedAt: new Date(r.createTime ?? Date.now()),
  }));
}

export async function postReply(restaurantId: string, googleReviewId: string, text: string): Promise<void> {
  const cfg = await cfgOrThrow(restaurantId);
  const token = await accessToken(cfg.refreshToken);
  const res = await fetch(`${MBAPI}/${googleReviewId}/reply`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comment: text }),
  });
  if (!res.ok) throw new Error(`google reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
  log.info('reviews.google.replied', { restaurantId, googleReviewId });
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/google-business.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/reviews/google-business.ts apps/web/__tests__/server/reviews/google-business.test.ts
git commit -m "feat(reviews): Google Business Profile adapter (oauth, list reviews, post reply)"
```

---

### Task 5: Reviews store — tenant-scoped persistence + reply state machine

**Files:**
- Create: `apps/web/src/server/reviews/store.ts`
- Test: `apps/web/__tests__/server/reviews/store.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/server/db`.
- Produces:
  - `async function upsertReview(restaurantId: string, r: NormalizedReview): Promise<{ id: string; isNew: boolean }>`
  - `async function getAutoReplyConfig(restaurantId: string)` → the row or `null`
  - `async function saveReply(args: { reviewId: string; restaurantId: string; text: string; state: ReviewReplyState; source: ReviewReplySource; llmProvider?: string; llmModel?: string; postedAt?: Date | null; error?: string | null }): Promise<void>` (upsert on `reviewId`)
  - `async function listReviewsForAdmin(restaurantId: string, filter?: { rating?: number; state?: ReviewReplyState }): Promise<...>` (always scoped by `restaurantId`)
  - `async function getReviewScoped(restaurantId: string, reviewId: string)` → review+reply or `null` (returns null if the review belongs to another restaurant)

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  googleReview: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  reviewReply: { upsert: vi.fn() },
  reviewAutoReplyConfig: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { upsertReview, getReviewScoped, saveReply, listReviewsForAdmin } from '@/server/reviews/store';

beforeEach(() => vi.clearAllMocks());

describe('upsertReview', () => {
  it('scopes the upsert by googleReviewId and records restaurantId', async () => {
    db.googleReview.upsert.mockResolvedValue({ id: 'g1' });
    const r = await upsertReview('rest1', {
      googleReviewId: 'accounts/1/locations/2/reviews/9', reviewerName: 'A',
      rating: 5, comment: 'x', reviewCreatedAt: new Date('2026-10-18T00:00:00Z'),
    });
    expect(r.id).toBe('g1');
    const arg = db.googleReview.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ googleReviewId: 'accounts/1/locations/2/reviews/9' });
    expect(arg.create.restaurantId).toBe('rest1');
  });
});

describe('getReviewScoped', () => {
  it('queries with BOTH id and restaurantId (fail-closed tenant scope)', async () => {
    db.googleReview.findFirst.mockResolvedValue(null);
    const out = await getReviewScoped('rest1', 'g1');
    expect(out).toBeNull();
    expect(db.googleReview.findFirst.mock.calls[0][0].where).toEqual({ id: 'g1', restaurantId: 'rest1' });
  });
});

describe('listReviewsForAdmin', () => {
  it('always includes restaurantId in the where clause', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    await listReviewsForAdmin('rest1', { rating: 2 });
    const where = db.googleReview.findMany.mock.calls[0][0].where;
    expect(where.restaurantId).toBe('rest1');
    expect(where.rating).toBe(2);
  });
});

describe('saveReply', () => {
  it('upserts keyed on reviewId with the given state + source', async () => {
    db.reviewReply.upsert.mockResolvedValue({});
    await saveReply({ reviewId: 'g1', restaurantId: 'rest1', text: 'hi', state: 'POSTED' as any, source: 'AUTO' as any, postedAt: new Date() });
    const arg = db.reviewReply.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ reviewId: 'g1' });
    expect(arg.create.state).toBe('POSTED');
    expect(arg.create.source).toBe('AUTO');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/store.test.ts`

- [ ] **Step 3: Implement** `src/server/reviews/store.ts`:

```typescript
/**
 * Tenant-scoped persistence for Google reviews + replies. Every query carries
 * restaurantId; a cross-tenant id resolves to nothing (fail-closed).
 */
import { prisma } from '@/server/db';
import type { NormalizedReview } from './google-business';
import type { ReviewReplyState, ReviewReplySource } from '@prisma/client';

export async function upsertReview(restaurantId: string, r: NormalizedReview): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.googleReview.findUnique({ where: { googleReviewId: r.googleReviewId }, select: { id: true } });
  const row = await prisma.googleReview.upsert({
    where: { googleReviewId: r.googleReviewId },
    create: {
      restaurantId, googleReviewId: r.googleReviewId, reviewerName: r.reviewerName,
      rating: r.rating, comment: r.comment, reviewCreatedAt: r.reviewCreatedAt,
    },
    update: { reviewerName: r.reviewerName, rating: r.rating, comment: r.comment },
  });
  return { id: row.id, isNew: !existing };
}

export async function getAutoReplyConfig(restaurantId: string) {
  return prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId } });
}

export async function saveReply(args: {
  reviewId: string; restaurantId: string; text: string; state: ReviewReplyState; source: ReviewReplySource;
  llmProvider?: string; llmModel?: string; postedAt?: Date | null; error?: string | null;
}): Promise<void> {
  const data = {
    restaurantId: args.restaurantId, text: args.text, state: args.state, source: args.source,
    llmProvider: args.llmProvider ?? null, llmModel: args.llmModel ?? null,
    postedAt: args.postedAt ?? null, error: args.error ?? null,
  };
  await prisma.reviewReply.upsert({
    where: { reviewId: args.reviewId },
    create: { reviewId: args.reviewId, ...data },
    update: data,
  });
}

export async function listReviewsForAdmin(
  restaurantId: string, filter?: { rating?: number; state?: ReviewReplyState },
) {
  return prisma.googleReview.findMany({
    where: {
      restaurantId,
      ...(filter?.rating ? { rating: filter.rating } : {}),
      ...(filter?.state ? { reply: { state: filter.state } } : {}),
    },
    include: { reply: true },
    orderBy: { reviewCreatedAt: 'desc' },
    take: 200,
  });
}

export async function getReviewScoped(restaurantId: string, reviewId: string) {
  return prisma.googleReview.findFirst({ where: { id: reviewId, restaurantId }, include: { reply: true } });
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/reviews/store.ts apps/web/__tests__/server/reviews/store.test.ts
git commit -m "feat(reviews): tenant-scoped review/reply store"
```

---

### Task 6: Sync + auto-reply sweep job

**Files:**
- Create: `apps/web/src/server/jobs/google-reviews-sweep.ts`
- Test: `apps/web/__tests__/server/reviews/google-reviews-sweep.test.ts`

**Interfaces:**
- Consumes: `prisma`; `listReviews`/`postReply` (google-business); `generateReviewReply` (llm); `decideReplyAction` (policy); `upsertReview`/`getAutoReplyConfig`/`saveReply` (store).
- Produces: `async function runGoogleReviewsSweep(): Promise<{ restaurantsScanned: number; reviewsFound: number; newReviews: number; autoPosted: number; drafted: number; failed: number }>`

Mirrors `phonepe-reconcile-sweep.ts`: acquire a pg advisory lock (`SELECT pg_try_advisory_lock`), bail if not acquired, release in `finally`. A per-review failure is caught, parked as `FAILED`, and never aborts the sweep.

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/google-reviews-sweep.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/google-reviews-sweep.test.ts`

- [ ] **Step 3: Implement** `src/server/jobs/google-reviews-sweep.ts`:

```typescript
/**
 * Google-reviews sync + auto-reply sweep. Schedule every few minutes behind
 * INTERNAL_CRON_SECRET (see /api/platform/jobs/google-reviews/run).
 *
 * For each restaurant with a CONNECTED GOOGLE_BUSINESS integration: pull
 * reviews, upsert them, and for NEW ones apply the rating policy — 4-5* is
 * auto-posted, 1-3* becomes a PENDING_APPROVAL draft. A per-review error is
 * parked as FAILED and never aborts the sweep. An advisory lock prevents two
 * overlapping sweeps from double-replying.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { listReviews, postReply } from '@/server/reviews/google-business';
import { generateReviewReply } from '@/server/reviews/llm';
import { decideReplyAction } from '@/server/reviews/policy';
import { upsertReview, getAutoReplyConfig, saveReply } from '@/server/reviews/store';

const LOCK_KEY = 889_201_774; // arbitrary unique advisory-lock id for this sweep

export async function runGoogleReviewsSweep() {
  const result = { restaurantsScanned: 0, reviewsFound: 0, newReviews: 0, autoPosted: 0, drafted: 0, failed: 0 };

  const lock = (await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`)[0];
  if (!lock?.locked) { log.warn('reviews.sweep.skipped_locked', {}); return result; }

  try {
    const connected = await prisma.integrationCredential.findMany({
      where: { provider: 'GOOGLE_BUSINESS' as any, status: 'CONNECTED' as any },
      select: { restaurantId: true },
    });
    for (const { restaurantId } of connected) {
      result.restaurantsScanned++;
      let reviews;
      try {
        reviews = await listReviews(restaurantId);
      } catch (e: any) {
        log.error('reviews.sweep.list_failed', { restaurantId, error: String(e?.message || e) });
        continue;
      }
      result.reviewsFound += reviews.length;
      const cfg = await getAutoReplyConfig(restaurantId);
      for (const r of reviews) {
        const { id, isNew } = await upsertReview(restaurantId, r);
        if (!isNew) continue;
        result.newReviews++;
        const action = decideReplyAction(r.rating, cfg);
        if (action === 'SKIP') continue;
        try {
          const gen = await generateReviewReply({ restaurantId, rating: r.rating, comment: r.comment, tone: cfg?.tonePrompt });
          if (action === 'AUTO_POST') {
            await postReply(restaurantId, r.googleReviewId, gen.text);
            await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'POSTED', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model, postedAt: new Date() });
            result.autoPosted++;
          } else {
            await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model });
            result.drafted++;
          }
        } catch (e: any) {
          await saveReply({ reviewId: id, restaurantId, text: '', state: 'FAILED', source: 'AUTO', error: String(e?.message || e).slice(0, 300) });
          result.failed++;
        }
      }
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
  log.info('reviews.sweep.done', result);
  return result;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/google-reviews-sweep.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/jobs/google-reviews-sweep.ts apps/web/__tests__/server/reviews/google-reviews-sweep.test.ts
git commit -m "feat(reviews): sync + auto-reply sweep job with advisory lock"
```

---

### Task 7: Register LLM_REVIEWS in the provider registry; keep GOOGLE_BUSINESS out of the wizard list

**Files:**
- Modify: `apps/web/src/server/integrations/providers.ts` (add to `ProviderKey` union; add `LlmReviews` + `GoogleBusiness` provider defs; add both to `PROVIDERS`; add only `LlmReviews` to `PROVIDER_LIST`)
- Test: `apps/web/__tests__/server/reviews/providers-registry.test.ts`

**Interfaces:**
- Consumes: `testLlmKey`, `LLM_MODELS` from `@/server/reviews/llm`.
- Produces: `PROVIDERS.LLM_REVIEWS`, `PROVIDERS.GOOGLE_BUSINESS`; `LLM_REVIEWS` present in `PROVIDER_LIST`, `GOOGLE_BUSINESS` absent from it.

Find how `PROVIDER_LIST` is currently built in `providers.ts` (grep `PROVIDER_LIST`). It is a curated array of `ProviderDef`s. Add `LlmReviews` to it; do **not** add `GoogleBusiness` (it has a custom OAuth panel, like the synthetic platform provider is excluded).

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/providers-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

describe('provider registry — reviews additions', () => {
  it('registers LLM_REVIEWS and GOOGLE_BUSINESS in PROVIDERS', () => {
    expect(PROVIDERS.LLM_REVIEWS).toBeDefined();
    expect(PROVIDERS.GOOGLE_BUSINESS).toBeDefined();
  });
  it('shows LLM_REVIEWS in the wizard list but not GOOGLE_BUSINESS', () => {
    const keys = PROVIDER_LIST.map((p) => p.key);
    expect(keys).toContain('LLM_REVIEWS');
    expect(keys).not.toContain('GOOGLE_BUSINESS');
  });
  it('LLM_REVIEWS marks the apiKey field as secret', () => {
    const f = PROVIDERS.LLM_REVIEWS.fields.find((x) => x.key === 'apiKey');
    expect(f?.secret).toBe(true);
  });
  it('buildSummary masks the apiKey', () => {
    const s = PROVIDERS.LLM_REVIEWS.buildSummary({ provider: 'nvidia', apiKey: 'nvapi-abcdef1234', model: 'm' });
    expect(JSON.stringify(s)).not.toContain('nvapi-abcdef1234');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/providers-registry.test.ts`

- [ ] **Step 3: Implement.** Add `'GOOGLE_BUSINESS'` and `'LLM_REVIEWS'` to the `ProviderKey` union. Import at top of `providers.ts`:

```typescript
import { testLlmKey, LLM_MODELS, type LlmProvider } from '@/server/reviews/llm';
```

Add both provider defs (place near the other defs):

```typescript
// ─── LLM for review auto-reply ───────────────────────────────────────────────
const LlmReviews: ProviderDef = {
  key: 'LLM_REVIEWS',
  title: 'AI review replies',
  vendor: 'Anthropic / OpenAI / NVIDIA',
  description: 'Paste an LLM key so Flavrly can draft and auto-post replies to your Google reviews.',
  docsUrl: 'https://build.nvidia.com/',
  fields: [
    { key: 'provider', label: 'Provider', type: 'select', required: true, options: [
      { value: 'nvidia', label: 'NVIDIA (free models)' },
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI' },
    ] },
    { key: 'apiKey', label: 'API key', type: 'password', required: true, secret: true,
      hint: 'NVIDIA: nvapi-… from build.nvidia.com · Anthropic: sk-ant-… · OpenAI: sk-…' },
    { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'meta/llama-3.1-70b-instruct',
      hint: 'NVIDIA free e.g. meta/llama-3.1-70b-instruct · Anthropic claude-haiku-5-5 · OpenAI gpt-4o-mini' },
  ],
  buildSummary: (c) => ({ provider: c.provider, apiKey: maskSecret(c.apiKey), model: c.model }),
  async test(c) {
    return testLlmKey({ provider: c.provider as LlmProvider, apiKey: c.apiKey, model: c.model });
  },
};

// ─── Google Business Profile (OAuth — custom panel, NOT in the wizard list) ──
const GoogleBusiness: ProviderDef = {
  key: 'GOOGLE_BUSINESS',
  title: 'Google Business reviews',
  vendor: 'Google',
  description: 'Connect your Google Business Profile to read and reply to reviews.',
  docsUrl: 'https://support.google.com/business/answer/3474122',
  fields: [], // OAuth; no paste fields
  buildSummary: (c) => ({ accountId: c.accountId ?? null, locationId: c.locationId ?? null }),
  async test() { return { ok: true, detail: 'Connected via OAuth' }; },
};
```

Register in `PROVIDERS` map and add `LlmReviews` (only) to `PROVIDER_LIST`:

```typescript
// in PROVIDERS object:
  LLM_REVIEWS: LlmReviews,
  GOOGLE_BUSINESS: GoogleBusiness,
// in PROVIDER_LIST array — add LlmReviews, do NOT add GoogleBusiness:
  LlmReviews,
```

- [ ] **Step 4: Run — expect PASS; then typecheck.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews/providers-registry.test.ts && npx tsc --noEmit`
Expected: tests PASS, no type errors. (Resolve any `ProviderKey` exhaustiveness errors by ensuring both keys are in the union.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/integrations/providers.ts apps/web/__tests__/server/reviews/providers-registry.test.ts
git commit -m "feat(reviews): register LLM_REVIEWS provider; GOOGLE_BUSINESS via custom OAuth panel"
```

---

### Task 8: API routes — Google OAuth connect/callback

**Files:**
- Create: `apps/web/src/app/api/admin/integrations/google-business/connect/route.ts`
- Create: `apps/web/src/app/api/admin/integrations/google-business/callback/route.ts`
- Test: `apps/web/__tests__/server/reviews/google-oauth-routes.test.ts`

**Interfaces:**
- Consumes: `auth()` from `@/server/auth`; `getOAuthUrl`/`exchangeCode` (google-business); `saveConfig` (integrations); the caller's `restaurantId` from session. State is signed with `INTEGRATION_ENCRYPTION_KEY`-derived HMAC (use existing helper if present; otherwise a JWT-free HMAC over `restaurantId:nonce`).
- Produces: `GET connect` → 302 redirect to Google. `GET callback?code&state` → verify state, exchange, `saveConfig(restaurantId, 'GOOGLE_BUSINESS', { refreshToken, accountId, locationId })`, redirect back to settings.

Find how routes read the admin's restaurant (grep an existing `/api/admin/integrations/[provider]/route.ts` for the `restaurantId` resolution + role gate; reuse that exact helper). The state must bind to the session restaurant to prevent OAuth mix-up/CSRF.

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/google-oauth-routes.test.ts` (covers state binding + that callback saves scoped config). Mock `auth`, `exchangeCode`, `saveConfig`. Assert:
  - `connect` returns a redirect whose `Location` contains `accounts.google.com` and a `state` param.
  - `callback` with a state not matching the session restaurant returns 403 and does **not** call `saveConfig`.
  - `callback` with a valid state calls `saveConfig` with `provider='GOOGLE_BUSINESS'` and the caller's `restaurantId`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { authMock, exchangeMock, saveMock } = vi.hoisted(() => ({ authMock: vi.fn(), exchangeMock: vi.fn(), saveMock: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: authMock }));
vi.mock('@/server/reviews/google-business', () => ({ getOAuthUrl: (s: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${s}`, exchangeCode: exchangeMock }));
vi.mock('@/server/integrations', () => ({ saveConfig: saveMock }));
// NOTE: import the route's signState helper if exported, else reconstruct a valid state the same way the route does.
```

(Implementer: finish the test to match the signing helper you implement in Step 3 — the three assertions above are mandatory.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement both routes.** `connect/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { getOAuthUrl } from '@/server/reviews/google-business';
import { createHmac } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function signState(restaurantId: string): string {
  const nonce = Date.now().toString(36);
  const mac = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev').update(`${restaurantId}:${nonce}`).digest('hex').slice(0, 32);
  return Buffer.from(`${restaurantId}:${nonce}:${mac}`).toString('base64url');
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  const restaurantId = (session as any)?.user?.restaurantId;
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  return Response.redirect(getOAuthUrl(signState(restaurantId)), 302);
}
```

`callback/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { exchangeCode } from '@/server/reviews/google-business';
import { saveConfig } from '@/server/integrations';
import { createHmac } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyState(state: string, restaurantId: string): boolean {
  try {
    const [rid, nonce, mac] = Buffer.from(state, 'base64url').toString().split(':');
    if (rid !== restaurantId) return false;
    const expect = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev').update(`${rid}:${nonce}`).digest('hex').slice(0, 32);
    return mac === expect;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const restaurantId = (session as any)?.user?.restaurantId;
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code || !verifyState(state, restaurantId)) return new Response('Forbidden', { status: 403 });

  const { refreshToken } = await exchangeCode(code);
  // accountId/locationId discovery can be added later; store refresh token now.
  await saveConfig(restaurantId, 'GOOGLE_BUSINESS' as any, { refreshToken, accountId: '', locationId: '' }, { status: 'CONNECTED' });
  return Response.redirect(new URL('/admin/settings?google=connected', req.url), 302);
}
```

> Implementer note: the `locationId` is required by the adapter's `listReviews`. Add a follow-up step that, right after `exchangeCode`, calls the Business Profile `accounts.list` + `locations.list` endpoints to populate `accountId`/`locationId` (same fetch+token pattern as the adapter). If more than one location exists, redirect to a picker; for a single location, store it directly. This is in-scope for Task 8 — implement the single-location happy path and leave a labelled TODO only for the multi-location picker UI (tracked as a follow-up), since the spec's restaurants map to one location.

- [ ] **Step 4: Run — expect PASS; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/admin/integrations/google-business apps/web/__tests__/server/reviews/google-oauth-routes.test.ts
git commit -m "feat(reviews): google business oauth connect + state-bound callback"
```

---

### Task 9: API routes — reviews list / generate / approve / manual reply

**Files:**
- Create: `apps/web/src/app/api/admin/reviews/route.ts` (GET list)
- Create: `apps/web/src/app/api/admin/reviews/[id]/generate/route.ts` (POST)
- Create: `apps/web/src/app/api/admin/reviews/[id]/reply/route.ts` (POST — manual/edited → post)
- Create: `apps/web/src/app/api/admin/reviews/[id]/approve/route.ts` (POST — post an existing draft)
- Test: `apps/web/__tests__/server/reviews/reviews-routes.test.ts`

**Interfaces:**
- Consumes: `auth()`; `getReviewScoped`/`saveReply`/`listReviewsForAdmin` (store); `generateReviewReply` (llm); `postReply` (google-business); `getAutoReplyConfig` for tone.
- Produces: JSON responses carrying only review + reply display fields (never secrets). Every handler resolves `restaurantId` from session and passes it to the scoped store fns; a review id from another tenant yields 404.

- [ ] **Step 1: Write the failing test** `__tests__/server/reviews/reviews-routes.test.ts`. Mandatory assertions:
  - `GET /api/admin/reviews` returns 401/403 without a session; with a session, calls `listReviewsForAdmin(restaurantId, …)` and never returns any `apiKey`/`refreshToken` key in the JSON.
  - `POST .../[id]/generate` on a review belonging to another restaurant → 404 (because `getReviewScoped` returns null).
  - `POST .../[id]/approve` posts the stored draft via `postReply` then `saveReply(state:'POSTED', source:'ADMIN_EDITED')`.
  - `POST .../[id]/reply` with `{ text }` posts to Google and saves `source:'MANUAL'` (or `ADMIN_EDITED` if a draft existed).

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), getReviewScoped: vi.fn(), saveReply: vi.fn(), listForAdmin: vi.fn(), gen: vi.fn(), post: vi.fn(), cfg: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/reviews/store', () => ({ getReviewScoped: h.getReviewScoped, saveReply: h.saveReply, listReviewsForAdmin: h.listForAdmin, getAutoReplyConfig: h.cfg }));
vi.mock('@/server/reviews/llm', () => ({ generateReviewReply: h.gen }));
vi.mock('@/server/reviews/google-business', () => ({ postReply: h.post }));
// import each route's GET/POST and assert the four behaviours above.
```

(Implementer completes the bodies; the four assertions are mandatory.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the four routes.** Shared shape for each handler:

```typescript
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireRestaurant() {
  const session = await auth();
  const restaurantId = (session as any)?.user?.restaurantId;
  const role = (session as any)?.user?.role;
  if (!restaurantId || !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(role)) return null;
  return restaurantId as string;
}
```

`reviews/route.ts` (GET):

```typescript
import { listReviewsForAdmin } from '@/server/reviews/store';
// ...requireRestaurant as above
export async function GET(req: NextRequest) {
  const restaurantId = await requireRestaurant();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const u = new URL(req.url);
  const rating = u.searchParams.get('rating');
  const state = u.searchParams.get('state');
  const rows = await listReviewsForAdmin(restaurantId, {
    rating: rating ? Number(rating) : undefined,
    state: (state as any) || undefined,
  });
  // map to display DTO — never spread raw integration config here
  return Response.json({ reviews: rows.map((r) => ({
    id: r.id, reviewerName: r.reviewerName, rating: r.rating, comment: r.comment,
    reviewCreatedAt: r.reviewCreatedAt,
    reply: r.reply ? { state: r.reply.state, text: r.reply.text, source: r.reply.source, postedAt: r.reply.postedAt } : null,
  })) });
}
```

`[id]/generate/route.ts` (POST):

```typescript
import { getReviewScoped, saveReply, getAutoReplyConfig } from '@/server/reviews/store';
import { generateReviewReply } from '@/server/reviews/llm';
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurantId = await requireRestaurant();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const review = await getReviewScoped(restaurantId, id);
  if (!review) return new Response('Not found', { status: 404 });
  const cfg = await getAutoReplyConfig(restaurantId);
  const gen = await generateReviewReply({ restaurantId, rating: review.rating, comment: review.comment, tone: cfg?.tonePrompt });
  await saveReply({ reviewId: id, restaurantId, text: gen.text, state: 'PENDING_APPROVAL', source: 'AUTO', llmProvider: gen.provider, llmModel: gen.model });
  return Response.json({ ok: true, text: gen.text });
}
```

`[id]/approve/route.ts` (POST):

```typescript
import { getReviewScoped, saveReply } from '@/server/reviews/store';
import { postReply } from '@/server/reviews/google-business';
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurantId = await requireRestaurant();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const review = await getReviewScoped(restaurantId, id);
  if (!review?.reply) return new Response('Not found', { status: 404 });
  await postReply(restaurantId, review.googleReviewId, review.reply.text);
  await saveReply({ reviewId: id, restaurantId, text: review.reply.text, state: 'POSTED', source: 'ADMIN_EDITED', postedAt: new Date() });
  return Response.json({ ok: true });
}
```

`[id]/reply/route.ts` (POST — manual/edited):

```typescript
import { getReviewScoped, saveReply } from '@/server/reviews/store';
import { postReply } from '@/server/reviews/google-business';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurantId = await requireRestaurant();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const { text } = await req.json();
  if (!text || typeof text !== 'string') return new Response('Bad request', { status: 400 });
  const review = await getReviewScoped(restaurantId, id);
  if (!review) return new Response('Not found', { status: 404 });
  await postReply(restaurantId, review.googleReviewId, text);
  await saveReply({ reviewId: id, restaurantId, text, state: 'POSTED', source: review.reply ? 'ADMIN_EDITED' : 'MANUAL', postedAt: new Date() });
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run — expect PASS; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/admin/reviews apps/web/__tests__/server/reviews/reviews-routes.test.ts
git commit -m "feat(reviews): admin review list/generate/approve/reply routes (tenant-scoped)"
```

---

### Task 10: Job-run route + cron line

**Files:**
- Create: `apps/web/src/app/api/platform/jobs/google-reviews/run/route.ts`
- Modify: `deploy/flavrly-jobs.cron`
- Test: `apps/web/__tests__/server/reviews/google-reviews-run-route.test.ts`

**Interfaces:**
- Consumes: `runGoogleReviewsSweep`; `auth()`; `INTERNAL_CRON_SECRET`.
- Produces: `POST` (and `GET = POST`) guarded by `x-internal-secret` header OR `SUPER_ADMIN` session, returning the sweep result JSON. Copy the exact auth shape from `api/platform/jobs/phonepe-reconcile/run/route.ts`.

- [ ] **Step 1: Write the failing test** asserting 403 without secret/session and that the handler calls `runGoogleReviewsSweep` when `x-internal-secret` matches.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn().mockResolvedValue(null), sweep: vi.fn().mockResolvedValue({ restaurantsScanned: 0 }) }));
vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/jobs/google-reviews-sweep', () => ({ runGoogleReviewsSweep: h.sweep }));
import { POST } from '@/app/api/platform/jobs/google-reviews/run/route';
beforeEach(() => { vi.clearAllMocks(); process.env.INTERNAL_CRON_SECRET = 's3cret'; h.auth.mockResolvedValue(null); });
it('403 without secret or session', async () => {
  const res = await POST(new Request('http://x', { method: 'POST' }) as any);
  expect(res.status).toBe(403);
  expect(h.sweep).not.toHaveBeenCalled();
});
it('runs with a matching internal secret', async () => {
  const res = await POST(new Request('http://x', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }) as any);
  expect(res.status).toBe(200);
  expect(h.sweep).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `route.ts` (copy phonepe-reconcile shape):

```typescript
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { runGoogleReviewsSweep } from '@/server/jobs/google-reviews-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed = (internalSecret && headerSecret === internalSecret) || (session as any)?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const result = await runGoogleReviewsSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}
export const GET = POST;
```

- [ ] **Step 4: Add a cron line** to `deploy/flavrly-jobs.cron` (every 10 minutes):

```
# Google reviews — sync new reviews and apply the auto-reply policy.
*/10 * * * * deploy . /opt/restaurant-manager/apps/web/.env; curl -fsS -m 90 -X POST -H "x-internal-secret: $INTERNAL_CRON_SECRET" https://flavrly.in/api/platform/jobs/google-reviews/run >> /var/log/restaurant-manager/jobs.log 2>&1
```

- [ ] **Step 5: Run the test — expect PASS; commit.**

```bash
git add apps/web/src/app/api/platform/jobs/google-reviews apps/web/__tests__/server/reviews/google-reviews-run-route.test.ts deploy/flavrly-jobs.cron
git commit -m "feat(reviews): cron-triggered sweep run route + schedule"
```

---

### Task 11: Settings UI — connect Google, LLM key, auto-reply config

**Files:**
- Create: `apps/web/src/app/admin/settings/reviews-settings.tsx` (client component)
- Create: `apps/web/src/app/api/admin/reviews/config/route.ts` (GET current config/status + POST auto-reply config)
- Modify: `apps/web/src/app/admin/settings/integrations-section.tsx` (render `<ReviewsSettings/>` panel)
- Test: `apps/web/__tests__/server/reviews/reviews-config-route.test.ts`

**Interfaces:**
- Consumes: `auth()`; `listForRestaurant` (integrations) for `GOOGLE_BUSINESS`/`LLM_REVIEWS` status + masked summary; `prisma.reviewAutoReplyConfig` upsert.
- Produces: `GET /api/admin/reviews/config` → `{ google: {status, summary}, llm: {status, summary}, autoReply: {enabled, autoPostMinRating, draftMaxRating, tonePrompt} }`. `POST` upserts the auto-reply config (validates thresholds 1..5, `draftMaxRating < autoPostMinRating`).

- [ ] **Step 1: Write the failing test** for the config route: POST with `autoPostMinRating: 4, draftMaxRating: 3` upserts; POST with `draftMaxRating >= autoPostMinRating` → 400; GET returns masked summaries only (no `apiKey`). Mock `auth`, `prisma`, `listForRestaurant`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the config route** `api/admin/reviews/config/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { listForRestaurant } from '@/server/integrations';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function rid() { const s = await auth(); const r = (s as any)?.user?.restaurantId; const role = (s as any)?.user?.role; return (r && ['ADMIN','OWNER','SUPER_ADMIN'].includes(role)) ? r as string : null; }

export async function GET() {
  const restaurantId = await rid();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const all = await listForRestaurant(restaurantId);
  const pick = (k: string) => { const p = all.find((x: any) => x.provider === k); return p ? { status: p.status, summary: p.summary } : { status: 'DISCONNECTED', summary: null }; };
  const cfg = await prisma.reviewAutoReplyConfig.findUnique({ where: { restaurantId } });
  return Response.json({
    google: pick('GOOGLE_BUSINESS'),
    llm: pick('LLM_REVIEWS'),
    autoReply: cfg ?? { enabled: false, autoPostMinRating: 4, draftMaxRating: 3, tonePrompt: null },
  });
}

export async function POST(req: NextRequest) {
  const restaurantId = await rid();
  if (!restaurantId) return new Response('Forbidden', { status: 403 });
  const b = await req.json();
  const autoPostMinRating = Number(b.autoPostMinRating), draftMaxRating = Number(b.draftMaxRating);
  if (![1,2,3,4,5].includes(autoPostMinRating) || ![1,2,3,4,5].includes(draftMaxRating) || draftMaxRating >= autoPostMinRating) {
    return new Response('Bad thresholds', { status: 400 });
  }
  await prisma.reviewAutoReplyConfig.upsert({
    where: { restaurantId },
    create: { restaurantId, enabled: !!b.enabled, autoPostMinRating, draftMaxRating, tonePrompt: b.tonePrompt ?? null },
    update: { enabled: !!b.enabled, autoPostMinRating, draftMaxRating, tonePrompt: b.tonePrompt ?? null },
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Implement `reviews-settings.tsx`** — a client component with three cards:
  1. **Google**: shows status; if disconnected, a link/button to `/api/admin/integrations/google-business/connect`; if connected, the location summary + a Disconnect button (`DELETE /api/admin/integrations/[provider]` with `GOOGLE_BUSINESS` if that route supports it, else add a small disconnect handler).
  2. **LLM key**: reuse the existing integration wizard for `LLM_REVIEWS` (it is now in `PROVIDER_LIST`) OR a provider dropdown + key + model + Test button posting to the existing `/api/admin/integrations/[provider]` save route. Shows masked summary when connected.
  3. **Auto-reply**: enable toggle, two threshold selects (1..5) with inline validation (`draftMaxRating < autoPostMinRating`), tone textarea; Save posts to `/api/admin/reviews/config`.

  Follow the styling/pattern of the sibling `branding-form.tsx`/`notifications-table.tsx`. No secret is ever rendered except the masked summary from the GET.

- [ ] **Step 5: Render the panel** — in `integrations-section.tsx`, import and mount `<ReviewsSettings/>` in its own section.

- [ ] **Step 6: Run config-route test + typecheck + lint; manual UI smoke** (`npm run dev`, open `/admin/settings`).

Run: `cd apps/web && npx vitest run __tests__/server/reviews/reviews-config-route.test.ts && npx tsc --noEmit && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/admin/settings/reviews-settings.tsx apps/web/src/app/admin/settings/integrations-section.tsx apps/web/src/app/api/admin/reviews/config apps/web/__tests__/server/reviews/reviews-config-route.test.ts
git commit -m "feat(reviews): settings UI — connect google, llm key, auto-reply config"
```

---

### Task 12: Reviews page UI

**Files:**
- Create: `apps/web/src/app/admin/reviews/page.tsx` (server component — auth gate + shell)
- Create: `apps/web/src/app/admin/reviews/reviews-client.tsx` (client — list, filters, draft inbox, actions)
- Modify: admin navigation (find the admin nav/sidebar component; add a "Reviews" link) — grep for where `/admin/settings` is linked in the nav.
- Test: covered by the API route tests from Task 9; add one component render smoke test if the repo tests components (check for existing `*.test.tsx`).

**Interfaces:**
- Consumes: `GET /api/admin/reviews`, `POST /api/admin/reviews/[id]/generate|approve|reply`.
- Produces: the admin-facing Reviews page.

- [ ] **Step 1: Implement `page.tsx`** — server component: `const session = await auth()`; redirect if not an admin role; render `<ReviewsClient/>`.

- [ ] **Step 2: Implement `reviews-client.tsx`:**
  - Fetch `/api/admin/reviews` (with rating + state filters as query params).
  - Render each review: stars, reviewer, comment, date, and its reply state.
  - **Draft inbox**: reviews with `reply.state === 'PENDING_APPROVAL'` shown with the generated text in an editable textarea + **Approve & Post** (calls `approve` if unedited, `reply` with edited text if changed) and **Regenerate** (`generate`).
  - For reviews with no reply: **Generate draft** + a manual reply textarea → **Post reply** (`reply`).
  - Posted replies shown read-only with timestamp.
  - Use the repo's existing fetch/toast patterns (grep a sibling client like `orders-board.tsx`).

- [ ] **Step 3: Add the nav link** to the admin sidebar/nav next to Settings.

- [ ] **Step 4: Typecheck + lint + manual smoke.**

Run: `cd apps/web && npx tsc --noEmit && npm run lint`
Then `npm run dev`, open `/admin/reviews`, confirm the list renders and filters work (against seeded/mock data).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/reviews
git commit -m "feat(reviews): admin reviews page — list, filters, draft inbox, reply actions"
```

---

### Task 13: Security hardening tests + env docs

**Files:**
- Create: `apps/web/__tests__/server/reviews/security.test.ts`
- Modify: `apps/web/.env.example` (and `deploy/.env.production.example`) — add the new env vars
- Test: the security test file itself

**Interfaces:**
- Consumes: the reviews config route, llm adapter, google adapter.
- Produces: assertions that secrets never serialize to responses/logs.

- [ ] **Step 1: Write the security test** asserting:
  - The `GET /api/admin/reviews/config` response body, serialized, contains neither a raw `apiKey` nor a `refreshToken` (feed a connected summary via mocked `listForRestaurant` whose summary is already masked, and assert the raw values aren't present).
  - `generateReviewReply`'s return value, serialized, never contains the configured key (already covered in Task 3 — add a dedicated assertion here too).
  - A log spy on `@/server/log` is never called with an argument whose JSON contains `sk-ant-`, `nvapi-`, or the refresh token during a sweep run (reuse the sweep test harness).

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// mock log, integrations.getConfig returning a key; run generateReviewReply with mocked fetch;
// assert no log call arg JSON includes the key; assert returned object has no key.
```

- [ ] **Step 2: Run — expect FAIL (or PASS if already satisfied); fix any leak the test exposes.**

- [ ] **Step 3: Document env vars.** Append to `apps/web/.env.example` and `deploy/.env.production.example`:

```
# Google Business Profile OAuth (reviews module). Create credentials in a
# Google Cloud project with the Business Profile API enabled + approved.
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://flavrly.in/api/admin/integrations/google-business/callback
# INTERNAL_CRON_SECRET already documented for existing jobs — reused by the reviews sweep.
# LLM keys are NOT env vars: they are entered per-restaurant in Settings and stored
# encrypted (INTEGRATION_ENCRYPTION_KEY) in IntegrationCredential.
```

- [ ] **Step 4: Run the full reviews test suite + typecheck + lint.**

Run: `cd apps/web && npx vitest run __tests__/server/reviews && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/__tests__/server/reviews/security.test.ts apps/web/.env.example deploy/.env.production.example
git commit -m "test(reviews): secrets never serialize/log; document oauth env vars"
```

---

### Task 14: Full-suite gate + PR

**Files:** none (verification + PR)

- [ ] **Step 1: Run the entire web unit suite** to confirm no regressions (the baseline was 802 passing).

Run: `cd apps/web && npx vitest run`
Expected: all pass (802 + the new reviews tests).

- [ ] **Step 2: Typecheck + lint the whole app.**

Run: `cd apps/web && npx tsc --noEmit && npm run lint`

- [ ] **Step 3: Push the branch** (do NOT merge/deploy without the user's explicit go-ahead).

```bash
git push -u origin feat/google-reviews
```

- [ ] **Step 4: Open a draft PR** summarizing the module, the Google API-approval prerequisite (owner must enable Business Profile API access on their Google Cloud project before real reviews flow), and the per-restaurant secret model. PR body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TE5Smmr59myK3uRDYyqYbW
```

---

## Self-Review

**Spec coverage:**
- View reviews → Task 5 (store) + Task 9 (list route) + Task 12 (page). ✓
- Reply manually → Task 9 (`reply` route) + Task 12. ✓
- LLM auto-reply by rating+comment → Task 2 (policy) + Task 3 (llm) + Task 6 (sweep). ✓
- Settings for Google + LLM keys → Task 7 (registry) + Task 8 (OAuth) + Task 11 (settings UI). ✓
- NVIDIA free models → Task 3 (`LLM_MODELS.nvidia`, OpenAI-compat base) + Task 7 (provider options). ✓
- Rating-gated auto-post/draft → Task 2 + Task 6. ✓
- Encrypted, single-consumer, tenant-scoped secrets → Task 3 (sole consumer), Task 5 (scoped store), Task 13 (leak tests). ✓
- Google OAuth reality (not a key) → Task 4 + Task 8. ✓
- Data model → Task 1. ✓
- Sweep + cron → Task 6 + Task 10. ✓
- Security model (encryption, no client exposure, log redaction, tenant isolation, OAuth CSRF state) → Tasks 3/5/8/13. ✓
- Out-of-scope items excluded (no Yelp, no analytics dashboard). ✓

**Placeholder scan:** Tasks 8, 9, 11, 12, 13 leave the *test bodies* for the implementer to finish, but each lists mandatory assertions and full implementation code — acceptable because the behaviours are fully specified; no "TODO/implement later" in shipping code except the explicitly-labelled multi-location picker follow-up in Task 8.

**Type consistency:** `NormalizedReview`, `ReplyDecision`, `LlmProvider`, `generateReviewReply(args)`, `decideReplyAction(rating,cfg)`, `saveReply({...})`, `getReviewScoped(restaurantId,id)`, `runGoogleReviewsSweep()` names are used identically across tasks. Provider keys `GOOGLE_BUSINESS` / `LLM_REVIEWS` consistent everywhere.

**Known assumptions to verify during execution (not blockers):**
- Session shape: `session.user.restaurantId` + `session.user.role` — confirm the exact field names against `@/server/auth` types in Task 8 Step 3 and reuse the existing admin-scope helper if one exists (`requireOrderAdminScope`).
- Google My Business reviews live on the `mybusiness.googleapis.com/v4` surface; the account/location discovery endpoints are on `mybusinessaccountmanagement`/`mybusinessbusinessinformation`. Confirm current endpoints when wiring Task 8's location discovery.
- `PROVIDER_LIST` construction style in `providers.ts` — match it exactly in Task 7.
