# Claude Code: Flavrly PG upstream issues hardening

Repository: hariskulkarni/maverick-food-hub
Start from branch: fix/flavrly-pg-safe-pilot-20261022
Review PR #29. Do not merge or deploy. Keep FLAVRLY_PG_NEW_PAYMENTS_ENABLED unset/false in production.

MISSION
Make the existing Flavrly PG integration bank-safe and operational without changing existing PhonePe, Razorpay, COD, wallet, restaurant tenancy, checkout routes or architecture except for isolated, tested corrections. Work in sequential small commits and stop rather than invent a bank API, settlement proof or licensing authorization. Do not treat webhook, UTR, SMS, Gmail, notifications or gateway SUCCESS as independent bank proof. Preserve processing of already-created payments when checkout is disabled.

UPSTREAM AUDIT BASELINE
YouPI-PG main d7b07414d803094525ceedd5cf81e8a38157263e (2026-10-22).
#60 source fix 3f5acc4 (rawText required, non-VERIFIED rejected, unique attributed UTR).
#61 source fix cfec0e4 (7-arg Java listener, signed package, allowlist, rebuilt APK).
#86 still open (terminal status can commit before webhook-delivery insert, so first-send SIGKILL loses the notification).
#89 merchant onboarding request (not verified security defect).
#82 GHCR package visibility requires upstream owner.
#70 P2P/account freeze is an acquirer/bank policy issue, not code workaround.
#56/#58 commercial license permission unanswered.
#48 official bank feed or CSV statement reconciliation requested, not present.
#30 SonarCloud findings require actual report, do not invent.
#59 ReviewGround LLM key optional; never store secret in repo.

PHASE 0 — BASELINE + GAP INVENTORY
- Fetch upstream main and record exact SHAs for gateway and built APK. Inspect active deployments and confirm they match; never assume repository APK is installed.
- Read existing apps/web/__tests__/server/payments/youpi-* tests, payment state machine, webhook flow and deploy scripts.
- Run baseline: cd apps/web && npm ci && npx prisma validate && npm run typecheck && npm run lint && npm run check:responsive && npm run test:ci && npm run build.
- Write docs/flavrly-pg/UPSTREAM_ISSUES_MATRIX.md listing issue, fixed upstream?, deployed?, local mitigation?, tests, blockers.
- Check all newly added tests and new job in this branch. Preserve prior tests.

PHASE 1 — FAIL-CLOSED GATEWAY + TENANT ROUTING
- Validate merchant binding at creation using a separate merchant ID/API credential per restaurant OR an authenticated provider-supported submerchant design. Ensure upstream gateway chooses correct receiving account and private status readback matches a trusted server-side account binding. Never allow client-selected VPA to decide bank routing. Prevent cross-tenant webhook reconciliation.
- Keep server secret out of browser and logs; sanitize base URL against SSRF, host/port changes and unsafe redirects; preserve localhost exception only as explicitly configured.
- Replace production-ready labels with research-pilot until licensing and authorization checked.
- Check optional merchantKey and webhookSecret interactions with upstream's actual API.
- Test two-restaurant isolation and mismatched VPA, no gateway fallback, no second checkout on uncertain prior attempt.

PHASE 2 — DURABLE WEBHOOK + OBSERVER SAFETY
- Issue #86 requires upstream patch/fork: persist terminal event and delivery intent in same SQLite transaction, with stable delivery ID, bytes and retry state; dispatch AFTER commit; recover on restart. Avoid non-atomic 'insert before fetch' half-fix.
- Write SIGKILL tests at terminal commit, pre-send, in-flight HTTP, before acknowledgment, and post-ack. At-least-once semantics and dedupe. Do not use stale original timestamp header on retries without protocol redesign; support signed timestamped retry with stable logical event identity.
- In Flavrly inbound webhook, HMAC over raw bytes, timestamp freshness for FIRST delivery, header/body ID agreement, maximum body size, no cross-tenant lookup, durable event inbox with leases/retry/backoff/DLQ. Reconcile from trusted gateway API; never blindly capture from event body.
- Review apps/web/src/server/jobs/youpi-webhook-replay.ts newly added on branch: it is currently a recovery helper only and NOT scheduled. Replace the provisional 'error' marker claim with explicit lease fields if needed; do not mark as processed if no definitive outcome. Add automated tests and secure cron route only after successful validation. Keep poller fallback independently operational.
- Upstream #60/#61: verify rather than reimplement. Assert rawText required, non-VERIFIED never attributes, package signed and allowlisted, native APK build+SHA256+device installation, concurrent UTR uniqueness and two distinct receiving accounts.

PHASE 3 — AUTHORITATIVE RECONCILIATION
- Add normalized bank transaction ledger and pluggable authorized bank/acquirer API provider. If no authorized API exists, add reviewed CSV bank-statement import for merchant operator and manual-review workflow. NEVER scrape bank credentials/screens or invent real-time feed.
- Store gateway observation and bank evidence separately. Exact bank account + direction=credit + amountPaise + unique bank reference + independent source + transaction time + merchant/order attribution must match. If evidence missing, ambiguous, delayed, duplicate, wrong amount, wrong recipient or disputed: REVIEW_REQUIRED; no fulfillment.
- Fix existing gateway status UTR mismatch: signed webhook contains UTR, status response lacks UTR. Save UTR only as OBSERVATION and match to independent bank evidence; do not weaken capture requirements.
- Make bank allocations idempotent and account-scoped; immutable audit events, unique bank reference scoped appropriately. Never count same bank credit twice.
- Create admin exception screens for unmatched credits, reversals, stale pending, duplicate payments, manual reconciliation and operator approvals (dual control for financial overrides).

PHASE 4 — ATOMIC CAPTURE, RETRY, ORDER STATE
- Gate direct-UPI online order in PAYMENT_PENDING (never kitchen/print/notify rider until verified). Preserve COD/wallet and existing PhonePe/Razorpay behavior.
- Introduce a single transactional capture allocation for order+payment; use DB row lock/unique constraint so concurrent worker/webhook cannot pay an order twice.
- Preserve both incoming funds if two independent bank credits exist; allocate one order fulfillment, create overcollection exception for second and refund explicitly.
- Make gateway create/retry crash-safe using attempt ID and provider idempotency key; no 'FAILED' state on network timeout with unknown remote outcome, instead probe/reconcile before retry. Reclaim failed cap slots carefully; cap by receiving account, not tenant.
- Do not auto-mark an already FAILED/CANCELLED payment as captured without late-payment exception review.
- Write concurrency tests, delayed webhooks, stale timestamps, upstream outage, manual reconciliation, cancelled order, failed payout and missing UTR.

PHASE 5 — SETTLEMENT, REFUNDS, CUSTOMER DATA
- Separate money flowing directly to a restaurant bank from aggregator-held payout and platform commission. Don't fabricate payout transfer or apply generic PSP fees to direct-UPI transactions.
- Refund-to-source is manual or via bank-approved refund API with explicit evidence and approver; no false 'automatic refund' promise. Reversals/chargebacks must be booked once.
- Track providerName='youpi' explicitly in accounting even though legacy PaymentMethod enum is PHONEPE/RAZORPAY. Prefer additive reporting changes or new rail metadata, do not break existing migration.
- Merchant customer intelligence may use completed orders for repeat customers, AOV, cohorts and loyalty only with consent, tenant isolation and data minimization; payment data does not automatically grant marketing opt-in.

PHASE 6 — SECURITY, LICENSING, GO-LIVE GATE
- #70: seek acquiring-bank confirmation for P2M usage, settlement rules, thresholds and compliance; rate limits cannot evade bank freeze risk.
- #56/#58: secure legally sufficient written commercial license for source, modifications, rebranding, SaaS and distribution before rollout.
- #82: allow upstream owner to make GHCR public; alternatively build internally from reviewed pinned SHA with SBOM, signatures and digest; don't use unknown 'latest'.
- #59: enable deterministic checks (SAST, secret scan, dependencies, SBOM), optional AI review via scoped secret.
- #30: obtain actual SonarCloud report and prioritize reproducible findings, no invented scores.
- Ensure versioned reversible Prisma SQL migrations and backup+restore drill. Current code has schema changes not clearly represented by explicit migrations: verify before touching production.
- Limit production rollout: sandbox, synthetic tests, on-device real observer tests without money, then isolated authorized micro-payments with monitored rollback. Never enable until full compliance and bank proof documented.

NON-NEGOTIABLE QUALITY BAR
- No broad refactor, no changing public API contracts, no blind git reset, no force push, no direct main change, no deployments or real-money calls.
- Each phase = one small commit, unit and integration tests, traceable evidence; no secret or PII in commits/logs.
- No pass by deleting tests or weakening assertions.
- End with PR comparison, changed files, measured test results, outstanding P0/P1 issues, rollback plan, exact conditions to enable FLAVRLY_PG_NEW_PAYMENTS_ENABLED.
- Escalate to human when upstream/license/bank authorization is required. Do not mark a task complete by simply inventing mocks.
