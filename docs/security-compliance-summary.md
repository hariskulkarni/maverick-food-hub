# Flavrly — Security & Compliance: Executive Summary

Consolidates the five reviews. Each links to its detailed doc. **Not legal advice; not a substitute for an external pentest.**

_Reviewed: 2026-07-05 · Next.js 15 + Prisma + NextAuth, self-hosted (Hostinger VPS, India) behind Cloudflare._

## Overall: 🟢 Strong

No high-severity vulnerabilities found. Findings are hardening, not open holes. Several fixes were implemented (below).

| # | Review | Verdict | Detail |
|---|--------|---------|--------|
| 1 | App security (OWASP) | 🟢 Strong | `security-audit.md` |
| 2 | Secrets & exposure | 🟢 Clean | `secrets-audit.md` |
| 3 | HTTP security headers | 🟢 Strong (+2 added) | `security-audit.md` |
| 4 | Rate limiting | 🟢 Implemented | `rate-limiting.md` |
| 5 | GDPR / DPDP compliance | 🟢 Improved | `legal-privacy-compliance.md` |

---

## 1. Injection, XSS, CSRF, auth, IDOR

| Class | Severity | Finding |
|---|---|---|
| **SQL injection** | ✅ None | Prisma parameterizes all queries; the few `$queryRawUnsafe` calls use hardcoded literals, zero user input. |
| **XSS** | ✅ None | React auto-escapes; the JSON-LD sink explicitly escapes `</script>` + U+2028/2029; QR SVG is library-generated. CSP is a backstop. |
| **CSRF** | 🟡 Low | Mutations are POST/PATCH/DELETE with `SameSite=Lax` cookies (blocks cross-site cookie send) + NextAuth CSRF tokens on `/api/auth`. Adequate. **Hardening:** add an `Origin` check on state-changing routes for defense-in-depth (no CSRF token on the 206 custom mutation routes). |
| **Broken auth** | ✅ Strong | OTP rate-limited (10/hr+20/day per phone, 5 fails→invalidate); 8h JWT, one active device; staff passwords argon2; +global auth backoff (see #4). |
| **IDOR** | ✅ None found | Data routes assert ownership (`order.customerId !== session.user.id → 404`); role gates in middleware + `requireSuperAdmin`/`requireAnyAdminApi`. |

## 2. Secrets & exposure — ✅ clean
No hardcoded keys, `.env` gitignored **and never committed** (clean history), all `NEXT_PUBLIC_*` vars non-secret, `passwordHash`/tokens never returned by APIs, logs sanitized. **Fixed:** removed temporary upload debug-logging that echoed request bytes.

## 3. HTTP security headers — ✅ strong
CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri/form-action 'self'`), X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy, HSTS (https-gated). **Added:** `poweredByHeader: false` + `Cross-Origin-Opener-Policy`. **Residual (M):** CSP `script-src` keeps `'unsafe-inline'/'unsafe-eval'` (needed for Next + Razorpay) → move to nonce-based CSP as a project.

## 4. Rate limiting — ✅ implemented
Global middleware limiter on all `/api`: **per-IP 600/min + per-user 600/min**; **auth tier 20/min per IP with exponential backoff** (2s→…→15min). 429 + `Retry-After`, fail-open. Large-upload/SSE routes exempted (with in-route limits). Store is in-memory (fine for single process; swap to Redis when scaling).

## 5. GDPR / DPDP — 🟢 improved
Data lives in **PostgreSQL on the VPS (India)**; uploads on the VPS/S3; payments via Razorpay (no card data stored). Privacy Policy, Terms, Cookie Policy pages exist. **Built:** cookie-consent banner + self-serve account/data deletion (right to erasure). Minimal PII collection; not over-collecting. **To-do (non-code):** name a Grievance Officer, state retention periods, secure the DB backup destination, lawyer review.

---

## Fixes implemented across these reviews
- Headers: `poweredByHeader: false`, COOP.
- Rate limiting: global IP+user limiter + auth backoff (middleware) + in-route limits on upload/import.
- Privacy: cookie-consent banner, self-serve data deletion.
- Hygiene: scrubbed upload debug logging; 8 MB cap on rider photo route.

## Prioritized backlog (your calls, mostly non-code)
1. **CI:** add `gitleaks` (secret scan) + `npm audit` (dependency CVEs) — the two blind spots of a static review.
2. **Confirm prod runtime:** https origin (HSTS active), OTP rate-limits on, demo mode off.
3. **Grievance Officer + retention periods** on `/privacy`; secure the **DB backups** (they hold all PII).
4. **Nonce-based CSP** (drop `unsafe-inline`) — meaningful XSS hardening.
5. **Origin check** on state-changing routes (CSRF defense-in-depth).
6. **Redis rate-limit store** when you scale beyond one instance.
7. External **pentest** before a major launch.
