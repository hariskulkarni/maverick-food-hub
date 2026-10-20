# Reviews & Pages Upgrade (R1–R6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Close review/page gaps vs Enatega/TastyIgniter: fix the rider-rating loop, add public + my-reviews pages, moderation/reply/flag, review-request automation, a help/order-issue page + rider feedback screen, and platform review analytics.

**Spec:** docs/superpowers/specs/2026-10-19-reviews-pages-design.md

## Global Constraints
- `prisma db push` (H29); deploy migrate=true. Tenant-scoped (requireManagedRestaurant) / SUPER_ADMIN (requireSuperAdmin) / fail-closed.
- Preserve OrderFeedback `visibleForRole` redaction + customer comment opt-in on EVERY new surface (public, rider).
- Reuse: src/server/reviews/*, notification channels (SMS/WhatsApp + push milestones.ts), Google reviews module, support/messages system.
- Branded + responsive (check-responsive.mjs); CI gate green (tsc/lint/guardrail/build/vitest).

## Dependency order / parallelism
- **T1 schema** blocks all → serial first.
- After T1: **Stream A** = T2(R1)→T3(R3)→T4(R4) (share the OrderFeedback write path; serial within A). **Stream B** = T5(R2). **Stream C** = T6(R5). **Stream D** = T7(R6). B/C/D parallel with A (read-only on feedback or disjoint surfaces).

---

### Task 1: Schema
**Files:** Modify `apps/web/prisma/schema.prisma`. Test: `npx prisma validate` + `npx prisma generate`.
- [ ] On `model OrderFeedback`: add `moderationStatus ModerationStatus @default(PUBLISHED)`, `moderatedByUserId String?`, `moderatedAt DateTime?`, `flagReason String?`, `reply String?`, `replyAt DateTime?`, `replyByUserId String?`. Add `enum ModerationStatus { PUBLISHED HIDDEN FLAGGED }`.
- [ ] On `model Order`: add `feedbackRequestedAt DateTime?`.
- [ ] Per-restaurant flow setting `autoPublishReviews Boolean @default(true)` — add to whichever model/JSON holds restaurant flow settings (find how flags like `scheduledOrdersEnabled` are stored; follow that pattern).
- [ ] `npx prisma validate` + `generate` pass. Commit. **Carry:** later code reads `moderationStatus` (PUBLISHED only on public/aggregate), `reply`, `autoPublishReviews`, `Order.feedbackRequestedAt`.

### Task 2 (R1): Rider-rating loop
**Files:** Create `apps/web/src/server/reviews/rider-rating.ts`; wire into the OrderFeedback create/update path (locate it — likely under src/server/reviews or an api/.../feedback route). Test: new test file.
- [ ] `recomputeRiderRating(riderId: string): Promise<void>` — average `OrderFeedback.deliveryRating` (non-null) across that rider's delivered orders (bounded to the most recent 100; document), write `RiderProfile.rating`. Never throws into the caller.
- [ ] Resolve rider from the order's assignment when a feedback with a deliveryRating is saved; call recompute. 
- [ ] Tests (TDD): rating set from one feedback; averaged across many; no-feedback keeps default; a failure in recompute does not fail the feedback save.

### Task 3 (R3): Moderation + reply + flag
**Files:** `apps/web/src/app/api/admin/feedback/[id]/route.ts` (PATCH); extend `apps/web/src/app/admin/feedback` UI; ensure storefront aggregate + any public query filter `moderationStatus = PUBLISHED`. Test: api + aggregate tests.
- [ ] PATCH (tenant-scoped, requireManagedRestaurant, try/catch thrown Response): set `moderationStatus` (hide/unhide/flag), `flagReason`, or `reply` (+ replyAt/replyByUserId, moderatedBy/At); audit each change. Reply length ≤ 1000.
- [ ] Admin feedback UI: status filter + hide/unhide/flag(with reason)/reply actions, bulk hide/unhide; redaction preserved.
- [ ] Make the storefront rating aggregate + public list (T5) count only PUBLISHED. 
- [ ] Tests: hide removes from aggregate + public; flag stores reason; reply persists; non-manager 403; bulk works.

### Task 4 (R4): Review-request automation + auto-publish setting
**Files:** hook into the DELIVERED transition (server/orders.ts transitionOrder, near pushOrderMilestone); the feedback create path (autoPublish); a restaurant flow setting UI toggle. Test: nudge + autoPublish tests.
- [ ] On DELIVERED: if the order has no feedback and `Order.feedbackRequestedAt` is null, send ONE feedback-request nudge (reuse push + SMS/WhatsApp channels) linking to leave-feedback; set `feedbackRequestedAt`. Idempotent, best-effort (never blocks the transition).
- [ ] Feedback create: if the restaurant's `autoPublishReviews` is false, new OrderFeedback gets `moderationStatus = HIDDEN` (pending) until an admin publishes (R3); else PUBLISHED (current behavior).
- [ ] Settings toggle for `autoPublishReviews` (admin settings reviews area).
- [ ] Tests: nudge once on delivered (not resent); autoPublish=false ⇒ pending; =true ⇒ published.

### Task 5 (R2): Public reviews + My reviews
**Files:** public reviews section on `/r/[slug]` + `GET /api/storefront/[slug]/reviews`; customer `My reviews` page (`apps/web/src/app/(customer)/profile/reviews`) + `GET /api/customer/reviews`. Test: both APIs.
- [ ] Public API: PUBLISHED in-app reviews (overall rating + comment ONLY if customer opted-in and `visibleForRole` permits a public/customer view; author first name or initial; date) + synced Google reviews; newest-first, paginated; no extra PII. Reads moderationStatus/reply from T1.
- [ ] Public UI: branded reviews section/page with aggregate + list + restaurant replies shown under reviews.
- [ ] My reviews: list the signed-in customer's own OrderFeedback (full own data), edit within the existing 48h window, show restaurant reply.
- [ ] Tests: public excludes HIDDEN/FLAGGED + non-opted comments; my-reviews shows own + edit-gate.

### Task 6 (R5): Help/order-issue page + rider feedback screen
**Files:** customer help/issue page (`apps/web/src/app/(customer)/help` or `/orders/[id]/issue`) + an API that creates a support ticket/message via the existing support/messages system; rider screen in `apps/rider-native` consuming `/api/rider/feedback`. Test: issue submission creates a ticket.
- [ ] Issue form: category + description (+ optional order link) → creates a support ticket/message (find the existing support/messages creation path; reuse it). Branded + responsive. Replace the policy-only refunds gap with a real flow (link from /refunds or /orders).
- [ ] Rider feedback screen: fetch `/api/rider/feedback`, render the redacted payload (delivery rating + opted-in comment only); add to rider nav.
- [ ] Tests: issue submission persists a ticket/message; (rider screen: TS-only check if rider-native has no node_modules — note it).

### Task 7 (R6): Platform review analytics
**Files:** `apps/web/src/app/platform/reviews-analytics` (or extend platform/feedback) + `GET /api/platform/reviews-analytics`. Test: aggregation + authz.
- [ ] SUPER_ADMIN-only (requireSuperAdmin). Aggregate across restaurants: average per criterion (food/delivery/overall), rating distribution, volume + trend over time, and a **low-star list** (recent ≤2★ in-app + Google). Read-only. Branded + responsive.
- [ ] Tests: aggregates from fixture feedback correct; low-star filters ≤2★; non-super-admin 403.

## Deploy
- Merge to main + deploy migrate=true (OrderFeedback/Order/flow schema change). Reuses existing notification + Google infra; no new external services.
