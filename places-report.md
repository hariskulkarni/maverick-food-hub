# Tier-1 Google Places reviews - report

Status: DONE. Branch feat/places-reviews. Not pushed/deployed.

Gate (apps/web, dummy DB urls): vitest 122 files / 1170 tests pass; tsc clean; next lint 0 errors (pre-existing warnings only); check-responsive pass; prisma validate + generate OK.

- placeId stored on ReviewAutoReplyConfig (1 per restaurant, restaurantId @unique): googlePlaceId, googlePlaceName, googlePlaceConnectedAt. GoogleReview gets source String @default("gbp").
- Reply deep-link: https://business.google.com/reviews (new tab, noopener). AI draft: POST /api/admin/reviews/[id]/draft (reuses generateReviewReply, persists nothing) + Copy button.
- Key never logged: URLs/bodies/error messages from Places are never logged (only path + status/kind); test asserts the key is absent from all log calls.
- Places failure-safe: fetchPlaceReviews never throws (empty + failed flag); reviews list route never calls Places; sync returns 502, connect still succeeds.
- Source flag: listReviewsForAdmin (include) -> GET /api/admin/reviews DTO -> ReviewsClient (badge, reply swap).
- Deploy: set GOOGLE_PLACES_API_KEY on VPS; inert until set; run prisma db push.
- Caveats: Places returns max 5 reviews, no pagination. googleReviewId is globally unique, so two restaurants linking the same placeId would share rows (edge case, per brief's id format). No server-side search throttle beyond 2-100 char query validation.
