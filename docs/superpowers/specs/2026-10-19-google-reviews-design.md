# Google Reviews Integration Module — Design Spec

**Date:** 2026-10-19
**Status:** Approved for implementation planning
**Scope:** New subsystem in Flavrly (multi-tenant food-ordering platform, Next.js 15 App Router, Prisma/PostgreSQL)

## 1. Goal

Let a restaurant admin, from within Flavrly:

1. Connect their Google Business Profile and **view** their Google reviews.
2. **Reply** to reviews — manually, or have an LLM auto-generate replies.
3. Configure an **LLM key** (Anthropic, OpenAI, or NVIDIA) so replies are drafted/posted automatically based on the review's **rating + comment**.
4. Do all of the above through a **fully functional end-to-end UI** with a settings area to connect Google and enter the LLM key.

**Hard security constraint (verbatim from request):** the keys "cannot be hacked by any means and [are] utilized at best and only for this segment and nothing else."

Honest interpretation: no system is literally unhackable. The module gives these secrets **the same defense-in-depth tier as Flavrly's payment credentials** — the strongest the codebase has — and guarantees the LLM key is reachable by *only* this feature (single-consumer, tenant-scoped), never a general-purpose proxy.

## 2. Key external reality

Google reviews **cannot** be read-in-full or replied-to with a pasteable API key:

- A Places API *key* returns at most 5 reviews, read-only, **no reply**.
- Reading all reviews **and posting replies** requires the **Google Business Profile API**: OAuth 2.0 with the business owner's consent, the location **claimed + verified** in Google Business Profile, **and** Google's one-time API-access approval (application, days-to-weeks).

Therefore the Google side is a **"Connect Google Business" OAuth flow**, not a key field. The LLM side *is* a pasteable key.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Google auth | **Full OAuth** — Google Business Profile API, real read + reply |
| Auto-reply policy | **Rating-gated:** 4–5★ auto-post immediately; 1–3★ generate a **draft** the admin approves/edits before it posts. Thresholds configurable per restaurant. |
| LLM provider | **Admin picks one of:** Anthropic (`sk-ant-…`), OpenAI (`sk-…`), NVIDIA NIM (`nvapi-…`, OpenAI-compatible, free-tier models) |

## 4. Approach

Reuse the existing `IntegrationCredential` store (per-restaurant, AES-256-GCM via `src/server/crypto.ts`, `@@unique([restaurantId, provider])`, server-only `getConfig`/`saveConfig`, masked `summary` for UI). Add new domain tables for reviews + replies. A single reply-generation service is the sole consumer of the LLM key.

Rejected alternatives:
- **Bespoke encrypted tables / own key management** — reinvents audited crypto, strictly weaker.
- **Platform-wide LLM key in env** — not per-restaurant, violates "only this segment," no tenant isolation.

## 5. Data model

### 5.1 New `IntegrationProvider` enum values
- `GOOGLE_BUSINESS` — encrypted config `{ refreshToken, accountId, locationId }`. Short-lived access token is **cached in Redis/memory, never persisted plaintext**.
- `LLM_REVIEWS` — encrypted config `{ provider: 'anthropic'|'openai'|'nvidia', apiKey, model }`.

Both stored via the existing `IntegrationCredential` row; `summary` holds only safe public display (connected account/location name, masked key tail `…last4`, chosen model).

### 5.2 New Prisma models (all `restaurantId`-scoped)

```
model GoogleReview {
  id              String   @id @default(cuid())
  restaurantId    String
  googleReviewId  String   @unique   // Google's review resource name
  reviewerName    String?
  rating          Int                 // 1..5 (STAR_RATING mapped to int)
  comment         String?
  reviewCreatedAt DateTime
  syncedAt        DateTime @default(now())
  reply           ReviewReply?
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId, reviewCreatedAt])
  @@index([restaurantId, rating])
}

enum ReviewReplyState { DRAFT PENDING_APPROVAL POSTED FAILED SKIPPED }
enum ReviewReplySource { AUTO MANUAL ADMIN_EDITED }

model ReviewReply {
  id           String   @id @default(cuid())
  reviewId     String   @unique
  restaurantId String
  state        ReviewReplyState  @default(DRAFT)
  text         String
  source       ReviewReplySource
  llmProvider  String?           // anthropic|openai|nvidia, null for pure-manual
  llmModel     String?
  postedAt     DateTime?
  error        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  review       GoogleReview @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  @@index([restaurantId, state])
}

model ReviewAutoReplyConfig {
  id               String   @id @default(cuid())
  restaurantId     String   @unique
  enabled          Boolean  @default(false)
  autoPostMinRating Int     @default(4)   // >= this rating auto-posts
  draftMaxRating   Int      @default(3)   // <= this rating becomes a draft
  tonePrompt       String?                // brand voice / instructions for the LLM
  updatedAt        DateTime @updatedAt
  restaurant       Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
}
```

A migration adds these models + the two enum values. Follows the repo's existing migration strategy (see audit note H29); no destructive change.

## 6. Components (isolated, independently testable)

### 6.1 `src/server/reviews/google-business.ts` — Google adapter
Interface-first so a mock backs tests.
- `getOAuthUrl(restaurantId)` → consent URL (scope `https://www.googleapis.com/auth/business.manage`).
- `handleOAuthCallback(code, restaurantId)` → exchange code, store refresh token encrypted, store account/location in summary.
- `getAccessToken(restaurantId)` → refresh-token → short-lived access token, cached.
- `listReviews(restaurantId, { since })` → normalized `{ googleReviewId, reviewerName, rating, comment, reviewCreatedAt }[]`.
- `postReply(restaurantId, googleReviewId, text)` → posts/updates the reply on Google.

### 6.2 `src/server/reviews/llm.ts` — LLM adapter (SOLE consumer of the LLM key)
- One interface, three backends. Anthropic native; OpenAI and NVIDIA share an OpenAI-compatible client (NVIDIA just sets `baseURL = https://integrate.api.nvidia.com/v1`).
- `generateReviewReply({ restaurantId, rating, comment, tone })` → `{ text, provider, model }`.
- The function fetches the key via `getConfig(restaurantId, 'LLM_REVIEWS')` **internally**; the key never leaves this module, is never a function argument from a route, never logged.

### 6.3 `src/server/reviews/policy.ts` — pure policy engine
- `decide(rating, config) → 'AUTO_POST' | 'DRAFT' | 'SKIP'`. No I/O. Fully unit-tested.

### 6.4 `src/server/jobs/google-reviews-sweep.ts` — sync + auto-reply job
- Advisory-lock guarded (mirrors `phonepe-reconcile-sweep.ts`).
- For each restaurant with a CONNECTED `GOOGLE_BUSINESS`: `listReviews({ since: lastSync })`, upsert new `GoogleReview` rows, run `policy.decide`:
  - `AUTO_POST` → `generateReviewReply` → `postReply` → `ReviewReply{state: POSTED, source: AUTO}`.
  - `DRAFT` → `generateReviewReply` → `ReviewReply{state: PENDING_APPROVAL, source: AUTO}` (not posted).
  - `SKIP`/no LLM configured → no reply row (or `SKIPPED`).
- Per-restaurant usage cap + rate-limit on LLM/Google calls to bound cost + abuse; failures parked as `FAILED` with error, never crash the sweep.

### 6.5 UI
- **Settings** (extends existing `admin/settings/integrations-section.tsx` + `integration-wizard.tsx`):
  - "Connect Google Business" button → OAuth; shows connected location + Disconnect.
  - LLM panel: provider dropdown (Anthropic/OpenAI/NVIDIA), key field (write-only; shows masked tail once saved), model dropdown per provider, "Test" button.
  - Auto-reply config: enable toggle, rating thresholds, tone/brand-voice textarea.
- **Reviews page** `src/app/admin/reviews/`:
  - List with rating filter + reply-state filter.
  - Draft inbox (PENDING_APPROVAL): view generated draft, edit, approve→post, or regenerate.
  - Manual reply box per review; posted replies shown with timestamp.

### 6.6 API routes (`/api/admin/reviews/*`, `/api/admin/integrations/google-business/*`)
- `GET /api/admin/reviews` — list (scoped, paginated).
- `POST /api/admin/reviews/[id]/reply` — manual/edited reply → post.
- `POST /api/admin/reviews/[id]/generate` — (re)generate a draft.
- `POST /api/admin/reviews/[id]/approve` — post an approved draft.
- `GET /api/admin/integrations/google-business/connect` → redirect to Google.
- `GET /api/admin/integrations/google-business/callback` → finalize OAuth.
- LLM key + auto-reply config saved through the existing `/api/admin/integrations/[provider]` path.

## 7. Security model (defense-in-depth = payment-cred tier)

1. **Encrypted at rest** — AES-256-GCM, `INTEGRATION_ENCRYPTION_KEY`; prod hard-fails without a dedicated key (no NEXTAUTH_SECRET fallback). Same as PhonePe/Razorpay creds.
2. **Never serialized to client** — every reviews/integrations API returns only masked `summary` (`…last4`, account/model names). A unit test asserts the raw key/refresh token never appears in any API response body or log line.
3. **Least-privilege / single-consumer** — the LLM key is read only inside `reviews/llm.ts`; the Google refresh token only inside `reviews/google-business.ts`. No other module imports them; no generic LLM proxy exists. This is the "only this segment and nothing else" guarantee.
4. **Tenant isolation (fail-closed)** — every DB query predicate carries `restaurantId`; admin endpoints gated by the existing ownership helper (`requireOrderAdminScope` pattern from the audit). A cross-tenant request resolves to zero rows, never another tenant's data.
5. **Log redaction** — reuse the notifications redaction helper; keys, tokens, and auth codes stripped from all log bodies.
6. **OAuth token hygiene** — refresh token encrypted at rest; access token short-lived, cached in memory/Redis, never persisted plaintext; `state` param + per-restaurant binding on the OAuth callback to prevent CSRF/mix-up.
7. **Abuse/cost bound** — per-restaurant rate limit + daily usage cap on LLM + Google calls.

Explicit honesty: this matches the highest protection tier in the codebase; it is not an absolute "cannot be hacked" guarantee, which no software can make.

## 8. Testing

- `policy.ts` — rating-gate truth table (boundaries at thresholds).
- Tenant-scope fail-closed — cross-tenant review/reply access returns nothing.
- **Key-never-serialized** + log-redaction assertions.
- Google adapter against a mocked Business Profile API (listReviews/postReply, token refresh).
- LLM adapter against mocked Anthropic + OpenAI-compatible (OpenAI/NVIDIA) endpoints.
- Reply state-machine transitions (DRAFT→PENDING_APPROVAL→POSTED, →FAILED on error).
- Sweep job: advisory-lock overlap guard; auto-post vs draft branch; failure parked not thrown.

## 9. Out of scope (YAGNI)

- Sentiment/analytics dashboards.
- Non-Google review platforms (Yelp, Facebook, TripAdvisor).
- Bulk historical backfill beyond the first sync window.
- Standalone auto-translation (the LLM handles language inline if asked).
- Replying from the customer app or platform-admin surface (admin-only).
