# Flavrly — Secrets & Exposure Audit

**Scope:** hardcoded keys, `.env` hygiene (incl. git history), client-side exposure, sensitive-data leaks in API responses and logs. Static scan of the repo.

_Reviewed: 2026-07-05._

## Result: ✅ clean

| Check | Result | Evidence |
|---|---|---|
| Hardcoded API keys (`sk-`, `rzp_live_`, AWS, GitHub, Slack) | ✅ None | Only matches are a **test fixture** (`maskSecret('rzp_live_abc1234')`) and a UI **placeholder** (`'rzp_live_xxxxxxxx'`). No real keys. |
| `API_KEY` / `SECRET` / `TOKEN` assigned to a literal | ✅ None | Everything reads from `process.env` or the encrypted `IntegrationCredential` store. |
| `.env` in `.gitignore` | ✅ Yes | `.env`, `.env.*` ignored; only `*.example` whitelisted; `deploy/.env.production` ignored. |
| `.env` in git **history** | ✅ Never committed | `git log --all --full-history -- '**/.env'` → empty. History is clean, so no purge needed. |
| Secrets in client (`NEXT_PUBLIC_*`) | ✅ All non-secret | Only APP_URL, SITE_URL, BRAND_NAME/TAGLINE, CURRENCY, DEFAULT_COMMISSION_PCT, SUPPORT_PHONE/WHATSAPP — all safe to be public. |
| API responses leak `passwordHash`/tokens | ✅ None | `passwordHash` is only **written** (argon2 hash / set null on delete), never selected. User endpoints (`/api/me`, `/api/customer/me`, rider auth) use explicit `select` lists without secrets. The `Response.json(u)` calls return assignments/menu-items, not users. |
| Secrets in logs / error messages | ✅ None | A `maskSecret()` helper exists; the only "secret" log line reports a **missing** webhook secret, not its value. Temporary upload-debug logging that echoed request bytes has been **removed** this pass. |
| Third-party keys server-side only | ✅ Yes | Razorpay `keySecret`, KYC tokens, SMTP creds used only in `src/server/*`; integration creds stored **encrypted**; card data never touches our DB (Razorpay holds it). |

## What changed this pass (code)

- `src/app/api/admin/upload/route.ts` — removed the diagnostic logging that wrote request-body bytes to logs and echoed body structure in the error response (kept the resilient parser + a clean generic error).

## Recommendations (defense-in-depth)

1. **Add a secret scanner to CI** — e.g. `gitleaks` on every push. Catches an accidental key commit *before* it ships, which is the one thing a static review can't guarantee for the future.
2. **Rotate anything ever pasted into a chat/screenshot** — if any real key (Razorpay, SMTP, KYC) has been shared outside the encrypted store or `.env`, rotate it as a precaution.
3. **`npm audit` in CI** (also in the security audit) — dependency-sourced leaks/vulns are the remaining blind spot of a source scan.
4. Keep the rule: **new `NEXT_PUBLIC_*` var = must be safe to publish.** Anything secret stays server-side and is read only in `src/server`.

**Bottom line:** no exposed secrets, clean git history, correct client/server split. This is in good shape.
