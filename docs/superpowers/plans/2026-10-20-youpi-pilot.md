# YouPI-PG Pilot Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add YouPI-PG as an opt-in, per-restaurant, experimental payment provider with safety rails (PENDING-until-reconciled, dual-path webhook+poller, raw-HMAC verify, replay dedupe, daily/amount caps, branded checkout), mirroring the audited PhonePe/Razorpay flows.

**Architecture:** New `YOUPI` provider adapter implementing the existing `PaymentProvider` interface; raw-HMAC webhook (template: Razorpay webhook); advisory-locked reconcile poller (template: `phonepe-reconcile-sweep`); idempotency via the existing `PaymentWebhookEvent` table; caps via a new atomic daily-usage counter. Only `verifyStatus()==CAPTURED` flips an order to PAID (single-winner `updateMany`).

**Tech Stack:** Next.js 15, TypeScript, Prisma/PostgreSQL, vitest, `fetch` (no new deps), `node:crypto` HMAC.

**Spec:** `docs/superpowers/specs/2026-10-20-youpi-pilot-design.md`

## Global Constraints

- **Mirror existing patterns, don't reinvent:** adapter → `src/server/payments/phonepe.ts`; webhook raw-HMAC verify → `src/app/api/payments/razorpay/webhook/route.ts`; reconcile sweep → `src/server/jobs/phonepe-reconcile-sweep.ts`; single-winner apply → `src/server/payments/reconcile.ts`; idempotency → existing `PaymentWebhookEvent` table; provider config → `src/server/integrations/providers.ts`.
- **Safety invariants (from spec §1) are non-negotiable and each has a test:** opt-in only; prod guard; PENDING-until-reconciled; dual-path; raw-HMAC; replay dedupe; atomic caps; tenant-scoped fail-closed.
- No new runtime deps; `fetch` for YouPI HTTP; `node:crypto` for HMAC. Secrets via `encryptJSON`/`IntegrationCredential`. No secret in client/logs.
- Test: `cd apps/web && npx vitest run <path>`. Gate: `tsc --noEmit`, `next lint`, `node scripts/check-responsive.mjs`, and `next build` (compile+typecheck; local sitemap/next-font failures are env-only).
- Branch `feat/youpi-pilot` (exists). Commit footer every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01TE5Smmr59myK3uRDYyqYbW`.
- Do NOT deploy. The live pilot needs a running YouPI instance (out of scope for code; all tasks use mocked fetch).

---

### Task 1: Schema — YOUPI provider + caps counter

**Files:** Modify `apps/web/prisma/schema.prisma`; Test `apps/web/__tests__/server/payments/youpi-schema.test.ts`

- Add `YOUPI` to `enum IntegrationProvider`.
- Add model `YoupiDailyUsage { id, restaurantId, day (DateTime @db.Date), count Int @default(0), updatedAt; @@unique([restaurantId, day]) }` for atomic daily-cap enforcement.
- Add `enum YoupiRequestStatus { REQUESTED APPROVED REJECTED DISABLED }` and model `YoupiFeatureRequest { id, restaurantId String @unique, status YoupiRequestStatus @default(REQUESTED), requestedById String?, requestedAt DateTime @default(now()), decidedById String?, decidedAt DateTime?, note String?, updatedAt DateTime @updatedAt }` for the approval workflow.
- Confirm `PaymentWebhookEvent` (existing) can key YouPI deliveries by `X-Gateway-Delivery-Id` (reuse its unique event-id column; no new table needed). If its schema can't represent a YouPI delivery, add a nullable `deliveryId` unique — otherwise reuse.
- Steps: add enum value + model → `npx prisma validate && npx prisma generate` → smoke test asserts `Prisma.IntegrationProvider.YOUPI` and `Prisma.ModelName.YoupiDailyUsage` → commit. (DB apply via `prisma db push` at deploy, per H29.)

### Task 2: YouPI API client (`fetch`, mockable)

**Files:** Create `apps/web/src/server/payments/youpi-api.ts`; Test `youpi-api.test.ts`

- `createYoupiPayment(cfg, { orderId, amountPaise, customer, redirectUrl })` → POST YouPI Payment API (`${cfg.baseUrl}` :6100 create) → `{ paymentId, checkoutUrl }`.
- `getYoupiStatus(cfg, paymentId)` → GET status → normalized `'CAPTURED'|'PENDING'|'FAILED'|'UNKNOWN'` + `{ utr?, amountPaise? }`. Map YouPI's success/failed/suspicious/expired/cancelled outcomes → the four VerifyStatus values (suspicious/expired/cancelled → FAILED or UNKNOWN per spec; document mapping).
- All via `fetch`; auth header from `cfg.apiKey`. Tests mock `fetch`.

### Task 3: Provider adapter (`PaymentProvider`) + selection guard

**Files:** Create `apps/web/src/server/payments/youpi.ts`; Modify `apps/web/src/server/payments/index.ts`; Test `youpi-provider.test.ts`

- Implement the same shape as `phonepeProvider`: `createOrder(args)` → calls Task 2 create, returns `ProviderOrder { providerName:'youpi', providerOrderId: paymentId, redirectUrl: checkoutUrl, ... }`; `verifyStatus(...)` → Task 2 status.
- In `index.ts` selection: return the YOUPI adapter **only** when ALL hold: (a) the restaurant's `YoupiFeatureRequest.status == APPROVED`; (b) the **platform** YouPI connection config exists (platform `IntegrationCredential` under `__platform__`); (c) the restaurant has set its receiving VPA. Effective config = platform connection (baseUrl/apiKey/webhookSecret) merged with the restaurant's VPA + caps. **Prod guard:** if YouPI would be chosen but any of (a)-(c) is missing, throw (mirror the C1 mock guard). Never auto-select YouPI. Super-admin DISABLED/REJECTED → not selectable (real-time revoke).

### Task 4: Atomic caps (daily count + max amount)

**Files:** Create `apps/web/src/server/payments/youpi-caps.ts`; Test `youpi-caps.test.ts`

- `assertUnderCap(restaurantId, amountPaise, cfg)`: atomic conditional UPDATE on `YoupiDailyUsage` for today — increment count only if `count < dailyLimit` (default 20, from cfg); if the atomic update affects 0 rows → throw `YoupiCapExceededError`. Also reject `amountPaise > cfg.maxAmountPaise`. Use the coupon-usage atomic pattern (single UPDATE … WHERE count < limit RETURNING, or upsert+conditional).
- Called at the start of `createOrder` (Task 3). Tests: 21st txn refused; over-max refused; concurrent can't exceed (simulate via the WHERE-guard).

### Task 5: Webhook — raw-HMAC + replay dedupe + reconcile-not-trust

**Files:** Create `apps/web/src/app/api/payments/youpi/webhook/route.ts`; Test `youpi-webhook.test.ts`

- Read **raw body** (`await req.text()`), compute HMAC-SHA256 with the restaurant's `webhookSecret` (resolved from `orderId`→restaurant like the Razorpay webhook), constant-time compare to `X-Gateway-Signature`. Mismatch → 401.
- `X-Gateway-Timestamp` within window (e.g. 5 min) else reject. Dedupe `X-Gateway-Delivery-Id` via `PaymentWebhookEvent` (insert; duplicate → 200 no-op).
- **Do NOT trust the body status.** Call `verifyStatus()` for the order, then apply via the single-winner reconcile path (Task 6). Return 200.
- Tests: tampered body→401; valid→triggers status verify (mock) + single-winner apply; replay→no-op; stale timestamp→reject; asserts the body's own "success" never directly marks PAID.

### Task 6: Reconcile apply + poller sweep

**Files:** Create `apps/web/src/server/payments/youpi-reconcile.ts` + `apps/web/src/server/jobs/youpi-reconcile-sweep.ts`; Tests for both

- `reconcileYoupiPayment(paymentId)`: load Payment, `getYoupiStatus`, and apply with a **status-preconditioned single-winner `updateMany`** (mirror `reconcilePhonePePayment` in `reconcile.ts`): only a CAPTURED status flips Order→PAID + Payment→CAPTURED, keyed on current status so concurrent webhook+poller produce one winner. FAILED→FAILED. UNKNOWN→keep PENDING.
- `runYoupiReconcileSweep()`: advisory-lock guard (mirror `phonepe-reconcile-sweep`), scan YOUPI Payments PENDING older than ~90s, reconcile each, count scanned/reconciled/abandoned. Add run-route `apps/web/src/app/api/platform/jobs/youpi-reconcile/run/route.ts` (copy phonepe run-route, `x-internal-secret`) + a cron line in `deploy/flavrly-jobs.cron` (every 2–5 min).
- Tests: single-winner (concurrent → one PAID); advisory-lock overlap; abandoned count; UNKNOWN stays PENDING.

### Task 7: Integration config (provider registry) + UI (opt-in, branded, experimental)

**Files:** Modify `apps/web/src/server/integrations/providers.ts`; the admin payments/integrations settings UI; Test `youpi-config.test.ts`

- Register `YOUPI` in `providers.ts`: fields `baseUrl`, `merchantId`, `apiKey`(secret), `webhookSecret`(secret), `receivingVpa`, `dailyLimit`(number, default 20), `maxAmountPaise`(number); `buildSummary` masks secrets; `test()` pings YouPI baseUrl/status health. Mark the provider description **Experimental**.
- UI: add YouPI to the per-restaurant payments/integrations settings (same wizard pattern as PhonePe/Razorpay), clearly labeled **Experimental — pilot only**, showing the caps. Opt-in per restaurant.
- Webhook URL hint shown to admin: `https://portal.flavrly.in/api/payments/youpi/webhook`.

### Task 8: Branded checkout + outcome pages (opted-in restaurants)

**Files:** the checkout/return/outcome surfaces for YouPI; Test render smoke where the repo tests components

- For opted-in restaurants, the return/outcome pages (success / pending / failed) we control are rendered with the **restaurant's storefront branding** (logo from `storefrontConfig`, brand colors, name) — never a generic unbranded screen. Reuse the storefront theme tokens/components.
- Where we hand off to YouPI's Checkout Portal, pass merchant name/logo via YouPI config where supported; our pre/post pages stay fully Flavrly/restaurant-branded.
- PENDING outcome clearly communicates "payment is being confirmed" (reflecting PENDING-until-reconciled).

### Task 8b: Restaurant feature-request page + request API

**Files:** Create a restaurant-admin page (e.g. `apps/web/src/app/admin/settings/youpi/page.tsx` + client) and `apps/web/src/app/api/admin/youpi/request/route.ts`; Test `youpi-request-route.test.ts`

- Page: explains the self-hosted/experimental gateway with a **prominent CAUTION block** (verbatim YouPI warnings: research/experimental, observer-based confirmation ≠ settlement guarantee, ≤20/day, pilot/low-value, you accept the risk). Shows current `YoupiFeatureRequest.status`. If not requested → a **"Request this feature"** button (requires an acknowledge-the-caution checkbox). If REQUESTED → "pending super-admin approval". If APPROVED → a **receiving-VPA** field + status + the caps in effect. Branded (restaurant storefront theme), responsive, dark-mode safe.
- `POST /api/admin/youpi/request`: `requireManagedRestaurant` → upsert `YoupiFeatureRequest` to REQUESTED for that restaurant (set requestedById/at); idempotent (re-request while REQUESTED = no-op). Reject if already APPROVED. `POST /api/admin/youpi/vpa` (or same page) sets the restaurant VPA only when APPROVED.
- Tests: request creates/does-not-duplicate; VPA set blocked unless APPROVED; tenant-scoped.

### Task 8c: Super-admin approvals queue + platform config

**Files:** Create a platform page `apps/web/src/app/platform/youpi/page.tsx` + client; `apps/web/src/app/api/platform/youpi/requests/route.ts` (GET list), `.../[restaurantId]/decision/route.ts` (POST approve/reject/disable), `.../config/route.ts` (GET/POST platform YouPI connection); Test `youpi-admin-routes.test.ts`

- All endpoints **SUPER_ADMIN only** (role gate; mirror existing `/platform/*` auth). 
- Platform config: store the YouPI **instance connection** (baseUrl, apiKey, webhookSecret) + default caps as a platform `IntegrationCredential` under the `__platform__` sentinel (encrypted; masked summary). A `test()` health-check button.
- Requests queue page: lists `YoupiFeatureRequest` rows (restaurant, status, requestedAt) with **Approve / Reject / Disable** actions → `decision` route sets status + decidedById/at + audit; change is **real-time** (next provider read reflects it). Approve only permitted once platform config exists.
- Add a "YouPI" entry to the platform sidebar/nav.
- Tests: non-super-admin → 403 on every endpoint; approve flips status + is reflected by the Task-3 guard; disable revokes; platform config stores encrypted + summary masks secrets.

### Task 9: Full-suite gate + PR

- `cd apps/web && npx vitest run` (no regressions), `npx tsc --noEmit`, `npx next lint`, `node scripts/check-responsive.mjs`, `npx next build` (compile+typecheck clean). Push `feat/youpi-pilot`, open a **draft** PR (do NOT merge/deploy — pilot needs the live YouPI instance + owner sign-off). PR body documents the safety invariants + the live-instance dependency.

## Self-Review

- Spec coverage: opt-in+guard (T3), prod guard (T3), PENDING-until-reconciled (T5/T6), dual-path (T5+T6), raw-HMAC (T5), replay dedupe (T5), caps (T4), branding (T8), schema (T1), tests throughout. ✓
- Placeholders: tasks reference concrete template files; "mirror X" is backed by a named existing file. The YouPI API request/response exact shapes are unknown until a live instance/README-examples are available — Task 2 normalizes defensively and documents the mapping; this is the one genuine unknown, flagged.
- Types: `VerifyStatus` ('CAPTURED'|'PENDING'|'FAILED'|'UNKNOWN') consistent across Tasks 2/3/5/6. Provider name 'youpi' consistent.
- Known dependency: live YouPI endpoint + its exact API contract. All tasks build/test against mocks; the live contract may require small adjustments in Task 2 once the instance is available.
