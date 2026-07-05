# Flavrly — API Rate Limiting

Applies IP-based and user-based limits to **every** `/api` route from one place (the edge middleware), with a strict tier + **exponential backoff** for auth endpoints. Fail-open by design — a limiter glitch never takes the API down.

_Added: 2026-07-05._

## How it works

**Middleware (`src/middleware.ts`)** runs an in-memory fixed-window limiter on all `/api/*` requests. The deployment is a single long-lived `next start` process (pm2 fork), so the counters are shared across all requests.

| Tier | Match | Per-IP | Per-user | Backoff |
|------|-------|--------|----------|---------|
| **Auth** | path contains `/auth/`, `login`, `signin`, `otp`, `verify`, `password`, `2fa` (incl. NextAuth `/api/auth/callback`) | **20 / min** | — (pre-login) | **Yes** — on breach, an escalating lockout: 2s → 4s → 8s … capped at 15 min per IP |
| **General** | all other `/api` | **600 / min** | **600 / min** (JWT session, no DB hit) | No |

Both an IP limit **and** a user limit apply to authenticated general calls (whichever trips first). Exceeding a limit returns **HTTP 429** with a `Retry-After` header.

### Exempt (never limited)
- `/api/events` (SSE stream) and `/api/admin/upload`, `/api/admin/menu/import` — **excluded from the middleware matcher** so their large/streaming bodies are never buffered/truncated. The two upload routes are rate-limited **in-route** instead (`rateLimit()` helper); the rider delivery-photo route got an 8 MB cap.
- `/api/auth/session`, `/api/auth/csrf`, `/api/auth/providers` — high-frequency, non-sensitive NextAuth polling.
- `/api/ready`, `/api/system/health`, `/api/demo-gate`, and any `*/webhook` (external, signature-verified — must not be dropped).

### Already-present per-route limits (kept, defense-in-depth)
OTP request/verify and payment-verify routes still enforce their own tighter limits (e.g. OTP: 10/hr + 20/day per phone, 5 bad tries → invalidate). The middleware is a coarse outer layer; these are the fine inner layer.

## Tuning
- Limits live at the top of `src/middleware.ts` (`ipLimit`, the `600`/`20` numbers, the backoff cap).
- The store is in-memory (per-process). When you scale to multiple instances, swap in the Redis-backed store (`buildRedisRateLimitStore()` already exists) so counters are shared — the middleware limiter would then move to the same store or an Upstash-style edge KV.

## Files changed
- `src/middleware.ts` — the limiter + auth backoff; matcher re-includes `/api` (minus the excluded routes).
- `src/app/api/admin/upload/route.ts`, `src/app/api/admin/menu/import/route.ts` — in-route limits.
- `src/app/api/rider/assignments/[id]/photo/route.ts` — 8 MB cap.

## Verify after deploy
Rapidly hit a normal endpoint > 600×/min from one IP → expect `429` + `Retry-After`. Hammer a login endpoint > 20×/min → expect a `429` whose `Retry-After` **grows** on repeat (backoff). Confirm a large video upload still works (its route is exempt).
