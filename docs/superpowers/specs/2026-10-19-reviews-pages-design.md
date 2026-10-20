# Reviews & Pages Upgrade (R1–R6) — Design Spec

**Date:** 2026-10-19
**Status:** Approved scope R1–R6.
**Basis:** gap matrix scratchpad/gaps/PAGES-REVIEWS-MATRIX.md. Flavrly already leads on review depth (3-criteria OrderFeedback food/delivery/overall + comment≤500 + photo + 7 issue tags + 48h edit + role-redacted `visibleForRole`; Google Business + LLM replies). This closes the specific gaps.

## Global constraints
- Next.js 15 / TS / Prisma / Postgres. Schema via `prisma db push` (H29); deploy with migrate=true.
- Tenant-scoped + fail-closed; admin via `requireManagedRestaurant()`, platform via `requireSuperAdmin()`.
- Reuse existing: OrderFeedback model + `visibleForRole` redaction (src/server/reviews/*, admin/feedback, platform/feedback, /api/rider/feedback), notification channels (SMS chain + WhatsApp + web push milestones.ts), Google reviews module.
- Branded UI (LogoMark, text-gradient-brand), responsive (check-responsive.mjs), CI gate green.
- Do NOT weaken existing redaction: public/rider surfaces must honor `visibleForRole` + customer opt-in for comment visibility.

## R1 — Rider-rating loop fix (BUG, correctness)
Today rider-allocator weights `RiderProfile.rating` and tiers/payout use it, but nothing writes it from customer `deliveryRating`. Fix:
- `server/reviews/rider-rating.ts`: `recomputeRiderRating(riderId)` = rolling average of `OrderFeedback.deliveryRating` over that rider's delivered orders (bounded window e.g. last 100, or all; document). Writes `RiderProfile.rating`.
- Call it when an OrderFeedback with a deliveryRating is created/updated (find the feedback create/update path), resolving the rider via the order's assignment. Idempotent, never throws into the feedback write.
- Tests: rating updates after feedback; multiple feedbacks average; rider with no feedback keeps default; dispatch score reflects the new value.

## R2 — Public storefront reviews + customer "My reviews"
- **Public storefront reviews** (`/r/[slug]` storefront): a reviews section/page listing PUBLISHED in-app reviews (overall rating + comment, author first-name/initial, date; comment only if customer opted-in + role allows) PLUS synced Google reviews, newest-first, paginated. Aggregate rating stays. No PII beyond what redaction permits.
- **Customer "My reviews"** (`/profile/reviews` or under profile): the customer sees their own OrderFeedback submissions (all fields they entered), can edit within the existing 48h window, and sees any restaurant reply (R3).
- API: `GET /api/storefront/[slug]/reviews` (public, published-only, redaction-applied), `GET /api/customer/reviews` (own).
- Tests: public list shows only PUBLISHED + redaction-correct (hidden/flagged excluded, non-opted comments hidden); my-reviews shows own + edit gate.

## R3 — Moderation + restaurant reply + abuse flag
- Schema (OrderFeedback): add `moderationStatus ModerationStatus @default(PUBLISHED)` enum `{PUBLISHED, HIDDEN, FLAGGED}`; `moderatedByUserId String?`; `moderatedAt DateTime?`; `flagReason String?`; `reply String?`; `replyAt DateTime?`; `replyByUserId String?`.
- Admin moderation queue (extend `/admin/feedback`): filter by status + rating; actions hide / unhide / flag (with reason) — tenant-scoped; redaction still applies to what the admin role sees. Bulk actions.
- **Restaurant reply**: admin writes a reply to an in-app review; reply shown to the customer (My reviews) and on the public list under that review. Reply length bounded.
- Only PUBLISHED reviews appear on public surfaces (R2) and in the storefront aggregate.
- API: `PATCH /api/admin/feedback/[id]` (moderationStatus/flagReason/reply), tenant-scoped, audit each change.
- Tests: hide removes from public + aggregate; flag records reason; reply persists + shows to customer; non-manager 403.

## R4 — Review-request automation
- On order `DELIVERED` (or a short delay after), send ONE feedback-request nudge to the customer via an available channel (web push milestones.ts + SMS/WhatsApp), linking to the leave-feedback flow — only if no feedback yet and not already requested. Idempotent (add `feedbackRequestedAt DateTime?` on Order, or a dedup marker).
- Flow setting (per restaurant): `autoPublishReviews Boolean` (default true = current behavior) — when false, new in-app reviews land `moderationStatus = HIDDEN`/pending until an admin publishes (TastyIgniter-style manual approval). Wire into the feedback create + R3 queue.
- Tests: nudge fires once on delivered for a customer with no feedback; not re-sent; autoPublish=false makes new reviews pending.

## R5 — Help/order-issue page + rider customer-feedback screen
- **Customer help/order-issue** page (`/help` or `/orders/[id]/issue`): structured issue form (category + description, optional order link) that creates a support ticket/message via the existing support/messages system (platform/support already exists) — not just static policy text. Replace the policy-only gap.
- **Rider customer-feedback screen** (apps/rider-native): a screen consuming the existing `/api/rider/feedback` (delivery rating + opted-in comment only, per redaction) so riders can see their own feedback. Add to rider nav.
- Tests: issue submission creates a ticket/message; rider feedback screen renders the redacted payload.

## R6 — Review analytics (platform)
- Platform page (`/platform/reviews-analytics` or extend `/platform/feedback`): aggregates across restaurants — average by criterion, trend over time, volume, rating distribution, and a **low-star alert** list (recent 1–2★ in-app or Google reviews) with links. Read-only, SUPER_ADMIN.
- Optional: emit a notification to the restaurant on a new 1–2★ review (reuse notification infra), behind a setting. (Keep minimal; the dashboard is the core.)
- Tests: aggregates compute correctly from fixture feedback; low-star list filters ≤2★; authz SUPER_ADMIN only.

## Dependency order / streams
- **T1 schema** (OrderFeedback moderation/reply fields + ModerationStatus enum + Order.feedbackRequestedAt + flow autoPublishReviews) blocks R2/R3/R4. Serial first.
- Then streams: **A** R1 + R3 + R4 (feedback-centric, share OrderFeedback write path — keep in one stream to avoid conflicts); **B** R2 (public + my-reviews read surfaces); **C** R5 (help page + rider screen); **D** R6 (platform analytics). B/C/D parallel after T1; A also after T1.
- Watch shared files: the feedback create/update path (R1 rating write + R4 autoPublish + R3 fields) → stream A owns it; R2/R6 are read-only on feedback.

## Testing + deploy
- vitest + tsc + next lint + check-responsive + next build all green.
- Deploy: merge to main + migrate=true (schema change). 
- No new external infra. Reuses existing notification channels + Google module.
