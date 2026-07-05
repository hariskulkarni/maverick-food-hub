# Flavrly — Security Review

**Reviewer role:** application security specialist · **Method:** source-code review of `apps/web` (Next.js 15 + Prisma + NextAuth) against the OWASP Top 10 and the requested checklist. **Not** a live penetration test.

> This is a static review. Complement it with a `npm audit`, a dependency/secret scan in CI, and — before a big launch — an external pentest.

_Reviewed: 2026-07-05._

---

## Verdict

**Strong baseline.** This is *not* a "zero security headers, injectable" app — the opposite. Parameterized DB access, escaped output, real auth rate-limiting, ownership checks, verified payment signatures, and a full security-header set are all present. Findings below are mostly **hardening**, not open holes. Two safe fixes were applied in this pass.

| Checklist item | Result |
|---|---|
| Scan against OWASP Top 10 | ✅ No high-severity issues found in review |
| Check all security headers | ✅ Strong set present (+2 added this pass) |
| SQL injection on inputs | ✅ Prisma parameterizes; raw queries carry no user input |
| XSS on inputs | ✅ React escaping + explicit JSON-LD escaping + CSP |
| Auth & session handling | ✅ Rate-limited OTP, 8h JWT, one-session-per-device, argon2 |

---

## Security headers (OWASP A05)

Set in `next.config.mjs`:

| Header | Value | Status |
|---|---|---|
| Content-Security-Policy | allowlist; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | ✅ Strong (see M1) |
| X-Frame-Options | `DENY` | ✅ |
| X-Content-Type-Options | `nosniff` | ✅ |
| Referrer-Policy | `strict-origin-when-cross-origin` | ✅ |
| Permissions-Policy | camera/mic off; geo/payment self | ✅ |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` (only when origin is https) | ✅ (verify prod is https) |
| **X-Powered-By** | now **removed** (`poweredByHeader: false`) | ✅ **added this pass** |
| **Cross-Origin-Opener-Policy** | `same-origin-allow-popups` | ✅ **added this pass** |

## OWASP Top 10 — findings

- **A01 Broken Access Control** — ✅ Role gates in `middleware.ts` (`/platform`→SUPER_ADMIN, `/admin`→ADMIN, …) *and* per-record ownership checks on data routes (e.g. `order.customerId !== session.user.id → 404`). API routes use `requireSuperAdmin` / `requireAnyAdminApi`. No IDOR found in the spot-check. Keep asserting ownership on every new `[id]` route.
- **A02 Cryptographic Failures** — ✅ Staff passwords hashed with **argon2**; integration credentials stored **encrypted** (`configEncrypted` + `decryptJSON`); signed tokens via HMAC-SHA256. Card data never stored (handled by Razorpay).
- **A03 Injection** — ✅ **SQL:** Prisma parameterizes all queries; the only `$queryRawUnsafe` calls use **hardcoded** provider literals, no user input. **XSS:** React auto-escapes; the JSON-LD sink explicitly escapes `<`, U+2028/U+2029 (correct anti-`</script>` handling); QR SVG is library-generated. No `eval`/`new Function` on user data (the `client.eval` hits are Redis Lua, safe).
- **A04 Insecure Design** — ✅ OTP abuse limits, one active session, typed confirmations on destructive actions, archived-vs-deleted separation.
- **A05 Security Misconfiguration** — ✅ Strong headers; **M1:** CSP `script-src` still allows `'unsafe-inline' 'unsafe-eval'` (needed today for Next + Razorpay inline) — the main residual XSS-mitigation gap; move to a nonce-based CSP as a follow-up.
- **A06 Vulnerable & Outdated Components** — ⚠️ Not verifiable statically. **Run `npm audit` (and in CI)**; the repo has an `audit:all` script — wire it into the pipeline.
- **A07 Identification & Auth Failures** — ✅ OTP: 10/hr + 20/day per phone, 40/hr per IP, 5 failed verifies → invalidate; `rateLimit()` also guards the verify route. JWT session 8h with 15-min refresh. Ensure `OTP_RATE_LIMITS_DISABLED` is **not** set and demo mode is **off** in prod.
- **A08 Software & Data Integrity** — ✅ Razorpay payment **signature is HMAC-verified** server-side (`invalid signature` rejects forgeries). Nit **L3:** the compare uses `!==` rather than `timingSafeEqual` — negligible risk for HMAC, but tidy it up.
- **A09 Logging & Monitoring** — ✅ Append-only audit log, error log, observability probes. **Housekeeping:** the temporary upload-debug logging (logs request body head) added while fixing video uploads should be trimmed so raw bytes aren't logged.
- **A10 SSRF** — ✅ Low exposure: server-side outbound calls go to fixed KYC/payment endpoints; remote image hosts are allowlisted (no wildcard). Keep any future "fetch this user URL" feature behind an allowlist.

## What was hardened this pass (code)

- `next.config.mjs` — `poweredByHeader: false` (removes `X-Powered-By`) and `Cross-Origin-Opener-Policy: same-origin-allow-popups`.

## Prioritized recommendations (your calls)

1. **Wire `npm audit` into CI** and fix High/Critical advisories (A06). Fastest ROI.
2. **Confirm prod runtime:** `NEXTAUTH_URL` is `https://…` (activates HSTS + `upgrade-insecure-requests`), and OTP rate limits + demo mode are correctly set for production.
3. **Nonce-based CSP** to drop `'unsafe-inline'`/`'unsafe-eval'` (M1) — meaningful XSS hardening; needs per-request nonces, so treat as a project, not a one-liner.
4. **Trim the upload debug logging** so request bodies aren't written to logs (A09 hygiene).
5. Use `timingSafeEqual` for the payment-signature compare (L3, cosmetic).
6. Add a lightweight security header test to CI (assert the headers above are present) so a future refactor can't silently drop them.

**Bottom line:** no emergency fixes required. Do #1 and #2 this week; schedule #3.
