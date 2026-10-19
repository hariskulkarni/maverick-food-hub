# Google Reviews — Production Setup & Status

Last updated: 2026-10-20

## What's live (code — all deployed to prod)

- **Reviews module**: per-restaurant Google Business Profile OAuth connect, view reviews, reply manually or via LLM (Anthropic/OpenAI/NVIDIA), rating-gated auto-reply (4–5★ auto-post, 1–3★ draft), daily sync cron, on-demand "Sync from Google", multi-location picker.
- **Secrets**: LLM key + Google refresh token encrypted at rest (`INTEGRATION_ENCRYPTION_KEY`, AES-256-GCM), per-restaurant, single-consumer, never serialized to client/logs.
- **Admin UI**: tabbed Settings, branded Reviews panel + reviews page.

## Google Cloud project (done)

- Project: **flavrly-512121** (owner: flavrlyadmin@gmail.com)
- OAuth client: `55517981138-glsd3…apps.googleusercontent.com`
- Consent screen: **Published / In production**; scope `https://www.googleapis.com/auth/business.manage`; branding complete (logo, home/privacy/terms, authorized domain `flavrly.in`).
- Authorized redirect URIs: `https://portal.flavrly.in/api/admin/integrations/google-business/callback` **and** `https://flavrly.in/api/admin/integrations/google-business/callback`.
- APIs enabled: My Business **Account Management**, My Business **Business Information**.
- VPS env: `GOOGLE_OAUTH_CLIENT_ID/_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI=https://portal.flavrly.in/api/admin/integrations/google-business/callback`.

## The ONE remaining blocker (Google-gated, platform-level, one-time)

**Business Profile API access must be granted to the Cloud project `flavrly-512121`.**

Why it can't be skipped: every review API call the app makes runs on the **project's** quota (not the restaurant owner's). Until the project is granted access, the review API quota is **0** → `listReviews`/reply return 403/429. Restaurant owners connecting via OAuth proves *they* own the profile; it does **not** grant the *project* API access.

What this is NOT: it is not per-restaurant and not an ongoing task. It is one platform approval; after it, every owner's review flow works with no further action.

### How to get it
Google's access-request form requires the **applicant to manage at least one verified Business Profile** (verified, ~60+ days active, website listed). The platform account currently manages none.

Paths:
1. **Create + verify one Business Profile** for Flavrly (your real business/office) under an account that can submit for project `flavrly-512121`, let it season, then submit the request at <https://support.google.com/business/contact/api_default>.
2. **Aggregator / "manage profiles at scale"** track (the form's own framing) — the correct lane for a multi-tenant platform; may still want one managed profile to demonstrate the integration.

Verification is a real-world step (postcard code / phone / video) only the business owner can complete; it cannot be automated or faked.

### Access-request justification (ready to paste)
> Business: Flavrly (flavrly.in) · Project ID: flavrly-512121 · APIs: Google My Business API (v4 reviews), My Business Account Management, My Business Business Information. Use case: multi-tenant food-ordering platform; each restaurant owner connects their own Google Business Profile via OAuth (scope business.manage) to view and reply to their own reviews inside Flavrly, manually or with an owner-configured AI assistant. We read only a connected owner's own locations' reviews and post replies they approve; no cross-tenant sharing; refresh tokens encrypted at rest. Expected QPS: low (a scheduled daily sync + on-demand, per restaurant).

Once granted, reviews activate with **zero further code changes**.

### Optional: OAuth verification
Removes the "unverified app" warning + the 100-user cap (Verification Center in the Google Auth Platform console). Not required for function.
