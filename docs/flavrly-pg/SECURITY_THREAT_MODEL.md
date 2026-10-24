# Flavrly PG — security threat model (STRIDE)

Owner: Agent G. Reviewed code: branch `pg/g-security` (base `pg/lead`, eebd11f + contract), read on 2026-10-24.

Other agents' branches (A–F) were not merged when this was written. Findings about current code that the D1–D14 contract is already replacing are marked *(being replaced: owner)*. The lead must re-check each one after integration and must not assume it is fixed.

All file:line references are under `apps/web/` unless prefixed.

## 1. Assets and trust boundaries

**Assets:**
- customer money (UPI credit into a restaurant bank account);
- order fulfilment (the kitchen must not cook unpaid orders);
- gateway credentials (`merchantId`, `merchantKey`, `webhookSecret`, encrypted in `IntegrationCredential`);
- `INTERNAL_CRON_SECRET`;
- customer PII (name, phone, address, UTR, payer VPA in webhook bodies);
- merchant receiving VPA and bank account;
- financial ledger (`PgAllocation`, `PgFinancialEvent`);
- audit log.

**Boundaries:**
1. Browser ↔ Flavrly (Next.js, NextAuth cookie, CSRF Origin guard).
2. Flavrly ↔ gateway (loopback HTTP `127.0.0.1:6100` per docs/YOUPI-SELF-HOST.md, X-Merchant-Key).
3. Gateway → Flavrly webhook (HMAC).
4. Android observer → gateway (device HMAC; covered in UPSTREAM_PARITY_AND_ISSUES.md #61).
5. Bank → restaurant (out of band). Flavrly only sees bank evidence via CSV import or manual entry (D4).
6. Cron → Flavrly job routes (`x-internal-secret`).
7. Operators → VPS (SSH, pm2, Authelia for the gateway admin).

## 2. STRIDE over the payment flow

| Step | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| 1. Checkout create (`orders` → `payments/online.ts` → `youpi.ts` → `youpi-api.ts`) | Session auth. Any tenant role can pay another tenant's order (T-12) | Shared platform merchant: upstream picks the receiver by merchantId, not by restaurant (T-06). Unknown create outcome is marked FAILED (T-13) | Payment row written before the gateway call | Upstream error text reaches the customer (T-08) | Daily cap consumed before create, never released (T-11) | KITCHEN can change the receiving VPA (T-04) |
| 2. Gateway hop | — | Gateway SUCCESS treated as capture (T-01) | — | `X-Merchant-Key` follows redirects (T-07). SSRF on baseUrl: **fixed on the config route**, still open on `/test` (T-03) | 20 s outbound per status poll (T-19) | — |
| 3. Inbound webhook (`payments/youpi/webhook`) | Raw-body HMAC with constant-time compare, but timestamp and delivery id are unsigned (T-09) | Body treated as a hint; reconcile re-reads the gateway | Durable insert before processing | Raw payload with UTR and payer kept indefinitely (T-18) | No body cap, no rate limit, decrypt before verify (T-10) | Global lookup by providerRef, no tenant binding (T-06) |
| 4. Status poll (`payments/youpi/status`) | Owner or tenant authz OK | Can trigger the capture path (T-01) | — | 404/403 enumeration (T-19) | 60/min/IP, each poll can hit the gateway (T-19) | — |
| 5. Reconcile (sweep, cron, `pg-worker`) | Cron secret compared with `===` (T-17) | Non-atomic double-capture guard (T-02). FAILED→CAPTURED allowed (T-01) | No append-only ledger yet *(being replaced: C)* | — | Advisory lock on a pooled connection (T-14) *(being replaced: B)*. Disabling a restaurant stops reconcile (T-05) | GET triggers a state change (T-17) |
| 6. Admin/platform PG routes | Super-admin routes use `requireSuperAdmin` and audit | VPA change without verification (T-04) | VPA and feature-request changes not audited (T-15) | Config summary masked. Secrets never returned (tested) | — | CSRF guard bypassed by any path containing `/webhook` (T-16) |
| 7. Infra / CI / deploy | CI SSH host key fetched with `ssh-keyscan` each run (T-24) | Production schema applied with `db push`, migrations drift (T-21) | — | Backups not encrypted (T-22) | Two conflicting pm2 ecosystems (T-23) | Critical advisories in next / next-auth (T-20) |

## 3. Findings (prioritised)

Severity reflects impact on money or tenant isolation. "Owner" is from the contract §3 table.

| ID | Sev | STRIDE | Location | Finding | Owner | Fix |
|---|---|---|---|---|---|---|
| T-01 | Critical | T/E | `src/server/payments/youpi-reconcile.ts:53-97` (`:90` FAILED in the capturable set) | `Payment.status=CAPTURED` is written from the gateway status API alone (SUCCESS + utr + amount). No bank evidence is involved, and FAILED→CAPTURED is allowed. A wrong or compromised gateway can "pay" orders. | C (+A) *(being replaced by D3)* | CAPTURED only via `allocateBankCredit()`. Remove FAILED from the set. Late payments go to a LATE_PAYMENT exception. |
| T-02 | High | T | `youpi-reconcile.ts:75-93` | The over-collection guard is `findFirst` then `updateMany`, which is not atomic. Two concurrent reconciles can both capture. | C *(D3 PgAllocation unique)* | Partial unique allocation per order plus row lock. Proven by a real-DB test. |
| T-03 | High | I (SSRF) | `src/app/api/admin/integrations/[provider]/test/route.ts:14-26` → `src/server/integrations/providers.ts:555-563` | `/test` does not block YOUPI (PUT/DELETE do, at `route.ts:35,91`). A tenant ADMIN or KITCHEN user can make the server GET any URL (redirects followed). The "reachable (HTTP n)" or error reply works as an internal port-scan oracle (127.0.0.1:6001 gateway admin, :8090, metadata). | F (route) + Lead (providers.ts) | Block YOUPI in `/test`. `YOUPI.test` must call `validateGatewayBaseUrl()` from `src/server/pg/security.ts` and use `redirect: GATEWAY_FETCH_REDIRECT`, with a generic error. |
| T-04 | High | E/T | `src/app/api/admin/youpi/vpa/route.ts:11-30`, `src/server/tenancy.ts:31,112` | `TENANT_ROLES=[ADMIN,KITCHEN]`, so KITCHEN staff can change the receiving VPA immediately. There is no audit, no re-verification and no dual control. | F (+A for D7) | ADMIN only. Audit before and after. The new VPA is unverified until the D7 `PgReceivingAccount` is VERIFIED. Notify the super admin. |
| T-05 | High | D/R | `src/server/payments/youpi.ts:39-40` used by `youpi-reconcile.ts:47-50` | Config resolution requires an APPROVED request. A DISABLE, or a VPA removal, makes every in-flight payment unreconcilable. This contradicts D7. | A | Separate resolution `forNew` from resolution for reconcile. |
| T-06 | High | S/T | `youpi.ts:42-58`, `src/app/api/payments/youpi/webhook/route.ts:58-61,121-135` | One platform merchantId and secret for all restaurants. Upstream routes by merchantId (#89: no per-merchant provisioning upstream). The webhook resolves payments globally with no restaurant check. | A (D7), B (D10) | Per-restaurant credentials plus a VERIFIED binding. Verify with the binding's secret and require payment.restaurant == binding.restaurant. Limit: one restaurant until #89 is solved. |
| T-07 | Medium | I | `src/server/payments/youpi-api.ts:89,140,192` | `fetch` follows redirects by default and the custom `X-Merchant-Key` header is forwarded. | A | `redirect: 'error'` (export `GATEWAY_FETCH_REDIRECT`). Re-validate baseUrl at call time with `validateGatewayBaseUrl`. |
| T-08 | Medium | I | `youpi-api.ts:54-56,110,115,124` → `online.ts:186-193` → `orders/[id]/pay/route.ts:54`, `payments/youpi/status/route.ts:72` | The gateway response body (≤200 chars) lands in `Payment.errorMessage` and is shown to the customer. `safeMsg` masks only `webhookSecret`, not `merchantKey`. | A (mask), D (surfaces) | Mask both keys. Return a generic customer message with a correlation id. |
| T-09 | Medium | S (replay) | `webhook/route.ts:30-41,70-84` | The HMAC covers the body only. Timestamp and delivery id are unsigned, so a captured delivery can be replayed with a fresh timestamp and new id. | B *(D10 work on branch: 7e00052 "timestamp-bound HMAC" — verify at integration)* | Standard Webhooks `id.timestamp.body`, dedupe on logical event id plus body hash. |
| T-10 | Medium | D | `webhook/route.ts:56-68`, `src/middleware.ts:86` | The webhook is exempt from the rate limit, reads an unbounded body, and decrypts config before verifying. | B *(7e00052 "caps body" — verify)* | Byte cap before read, cached secret, IP limit on bad signatures. |
| T-11 | Medium | D | `src/server/payments/youpi-caps.ts:24-43`, `online.ts:123-133` | The per-restaurant daily cap is consumed before create and never released. A customer can exhaust it. | A (D9) | Reservations per receiving account, released when an attempt never became payable. Per-customer limit. |
| T-12 | Medium | E | `src/app/api/orders/[id]/pay/route.ts:35-37` | Ownership is enforced only for CUSTOMER. Any tenant ADMIN, KITCHEN or RIDER can start a checkout on another restaurant's order. | D | `userCanAccessRestaurant(order.branch.restaurantId)` for non-customers. |
| T-13 | Medium | T | `online.ts:141-142,183-188` | Timeout, 5xx or network error → FAILED, and `attemptKey=count+1`, so a second live session is possible. | A (D8) | `CREATE_UNKNOWN` state plus a cuid attempt key. Refuse a new session until the unknown one is resolved. |
| T-14 | Medium | D | `src/server/jobs/youpi-reconcile-sweep.ts:25,69` (base) | `pg_try_advisory_lock` on a pooled connection can leak and silently stop the sweep. Payments older than 24 h are only counted. | B *(8b31ab3 PgJobLease)* | Lease with expiry, plus an alert when `abandoned > 0`. |
| T-15 | Low | R | `admin/youpi/request/route.ts:27-31`, `admin/youpi/vpa/route.ts:29` | No `audit()` on the feature request or VPA change. Re-requests are unlimited after a rejection. | F | Audit, plus a super-admin reset after a rejection. |
| T-16 | Low | S (CSRF) | `src/middleware.ts:65-82` | `csrfGuard` skips any path that contains `/webhook` and allows a missing Origin. No admin route matches today, but it is latent. | Lead | Exact allowlist of provider webhook paths. Require Origin or `Sec-Fetch-Site: same-origin` for cookie mutations. |
| T-17 | Low | S/E | `src/app/api/platform/jobs/youpi-reconcile/run/route.ts:17-23,29`; the same pattern in B's `platform/jobs/pg-worker/run/route.ts` (`GET = POST`, `headerSecret === internalSecret`) | A state-changing job runs on GET (skipped by csrfGuard). Secret compared without constant time. | B | POST only, `crypto.timingSafeEqual`. |
| T-18 | Low | I | `webhook/route.ts:107`, `src/app/api/orders/route.ts:80-81` | The raw webhook payload (UTR, payer) is kept forever. `placeOrder` failure logs the full body and returns `detail: message`. | B (retention), D (orders) | Retention purge or redaction (DPDP). Log ids only. |
| T-19 | Low | I/D | `src/app/api/payments/youpi/status/route.ts:21-63` | 404 vs 403 order-existence oracle (cuid ids, so low impact). Each poll can make a 20 s outbound call. | D | Uniform 404. At most one gateway probe per payment per 15 s. |
| T-20 | High (supply chain) | E/I | `apps/web/package-lock.json` (`npm audit`, 2026-10-24) | 26 advisories: 4 critical (`next` <15.5.21 incl. Server Actions SSRF/DoS/cache confusion; `next-auth`/`@auth/core` ≤0.41.2 incl. fail-open config errors and OAuth check-cookie binding), 14 high (`nodemailer` ≤10.1.3 file read/SSRF, `axios`, `sharp`, `zod`, `postcss`, …). Report in `~/flavrly-pg-evidence/2026-10-24/agent-g/npm-audit.json`. | Lead | Upgrade next and next-auth in a separate, regression-tested PR (major bumps). Make audit blocking once clean. |
| T-21 | High (ops) | T | `scripts/deploy-remote.sh` (`--migrate` → `prisma db push`), `prisma/migrations/` | Production applies schema with `db push`. On a fresh DB the committed migrations do **not** produce `schema.prisma`: `migrate diff --exit-code` = 2, with 26 tables missing, including all `Pg*`, YoupiDailyUsage and YoupiFeatureRequest. | C (baseline migration) + Lead | See DEPLOYMENT_AND_ROLLBACK.md §2: baseline migration, `migrate resolve --applied` on production after a schema-equality check, then `migrate deploy` only. |
| T-22 | Medium (ops) | I | `deploy/backup.sh:58,83-89` | `pg_dump | gzip`, with an optional rclone copy off the host. **Not encrypted** before leaving the host. No restore drill is scripted. | Lead/ops | Encrypt (age/gpg) before rclone. Quarterly restore drill (OPERATIONS_RUNBOOK.md §5). |
| T-23 | Low (ops) | D | `ecosystem.config.js` (flavrly-prod/flavrly-demo sharing `.next`) vs `deploy/ecosystem.config.cjs` (rm-web); `deploy-remote.sh` restarts `rm-web` | Two process definitions. Which one is live is unverified. A demo process sharing the prod `.next` and DB would also run PG code. | Lead/ops | Confirm the live pm2 list. Keep one ecosystem file. Make sure the demo has `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` unset and no PG cron. |
| T-24 | Low (CI) | S | `.github/workflows/deploy.yml` (Configure SSH) | The VPS host key is learned with `ssh-keyscan … \|\| true` on every run, which is trust-on-first-use from a fresh runner. `ci.yml`/`deploy.yml` use tag-pinned actions and have no top-level `permissions:`. | Lead | Store the known host key as a secret. Pin actions by SHA (as `codeql.yml` does). Add `permissions: contents: read`. |
| T-25 | Medium (gateway) | T | fork `packages/db/src/migrations/verification-hardening.js:31-45` | The unique "one attributed observation per account+UTR" and "one session per observation" indexes are created inside `try/catch` with a warn-only fallback. Whether they exist in the deployed SQLite is unverified. | Owner (ops, read-only check) | Run the `sqlite_master` check from UPSTREAM_PARITY_AND_ISSUES.md #60. |

## 4. Implemented in this branch (Agent G)

- **`src/server/pg/security.ts` — `validateGatewayBaseUrl()`:**
  - http(s) only, and https in production;
  - no credentials, query or fragment;
  - never 0.0.0.0/8, link-local or metadata (169.254/16, fe80::/10) or multicast;
  - loopback only with `FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY=true`;
  - private, CGNAT or ULA only outside production with `FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY=true`;
  - every DNS answer is checked;
  - IPv4-mapped and NAT64 forms are judged by their embedded IPv4 address;
  - errors never echo the URL.

  Also exports `GATEWAY_FETCH_REDIRECT='error'` for fetch callers. Tests: `__tests__/server/pg/security.test.ts` (38).
- **`src/app/api/platform/youpi/config/route.ts`** calls the validator before saving. Tests added to `__tests__/server/payments/youpi-admin-routes.test.ts`:
  - metadata, private, loopback-without-flag, credentials and query are rejected without saving or echoing;
  - loopback is accepted with the flag;
  - `merchantKey` and `webhookSecret` never appear in the response or the audit.

  The 5 rejection tests were confirmed to fail on the previous route.
- **Limitations:**
  - Save-time DNS validation does not stop DNS rebinding at fetch time. T-07 (`redirect:'error'`, call-time re-validation) is still needed.
  - Already-stored configs are not re-validated.
- **CI** (`.github/workflows/ci.yml`, `codeql.yml`):
  - `migrate deploy` plus drift check, `test:db`, npm audit report;
  - CodeQL `security-extended`;
  - gitleaks unchanged.

## 5. Controls confirmed present (base branch)

- Webhook HMAC constant-time compare with a length pre-check (`webhook/route.ts:30-41`).
- Status route owner and tenant authz (`status/route.ts:47-52`).
- `requireSuperAdmin` plus audit on the platform config and decision routes.
- YOUPI blocked on the generic integration PUT/DELETE.
- `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` defaults off in production (`src/server/payments/index.ts:172-185`).
- Global API rate limit in middleware.
- gitleaks over full history in CI.
