# Flavrly PG — Final GO / NO-GO

Date: 2026-10-24. Code: `pg/lead` (gate fully green at `cc9fef2`; later commits are docs). Author: lead (Claude Code), for owner decision.

## Recommendation

**NO-GO for real-money production activation.**
**GO for merging the engineering work** (after human code review) **with `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` unset/false in production.**

Status label: **ENGINEERING COMPLETE (pilot scope) / PRODUCTION BLOCKED.**

This is not a claim of bank, NPCI, RBI or licence approval. None exists in evidence.

## Why the engineering is ready for review

- Money can only be marked CAPTURED by `allocateBankCredit()` with a matching bank credit (same receiving account, CREDIT,
  exact signed payable paise, reference = authenticated UTR, time window). Gateway SUCCESS, redirects, webhook bodies,
  UTR or amount alone never capture (FINANCIAL_INVARIANTS.md; `tests/db/h-adversarial.test.ts`).
- One bank credit is allocated at most once; one order is released at most once — enforced by row locks and partial
  unique indexes, proven under 20-way concurrency and crash/lease-expiry recovery (`tests/db/*`).
- Unpaid direct-UPI orders never reach kitchen, KOT, rider dispatch, auto-accept or GMV.
- Webhooks are authenticated (timestamp-bound HMAC, per merchant), durably stored before 200, processed by a leased worker
  with retries and dead-letter; job overlap is guarded by DB leases.
- Existing PhonePe / Razorpay / COD / wallet behaviour: full unit suite green (1542), no regressions found by independent QA.
- Migrations reproduce the schema exactly from empty (drift check in CI).

## What blocks production (owner / external — cannot be solved in code)

| Gate | Blocker | Owner |
|---|---|---|
| Bank | Each receiving account confirmed by its bank as a merchant/current account allowed to receive business UPI (P2M), with thresholds (G-BANK-1/2, G-NPCI-1, upstream #70) | Owner + restaurant + bank |
| Bank data | No authorised live bank feed (upstream #48). Only CSV statement import + dual-control manual entry exist → capture is **not real-time**; orders wait for a statement | Owner + bank |
| Legal | Counsel opinion that the direct-to-merchant model is outside RBI PA authorisation (G-RBI-1) | Owner + counsel |
| KYC | Proof each bound account belongs to the restaurant's legal entity (G-KYC-1). `VERIFIED` in software is not KYC | Owner / ops |
| Multi-tenant | Upstream cannot provision per-restaurant merchants (#89) → **at most one restaurant** per gateway merchant (G-KYC-3) | Owner / upstream |
| Licence | Written commercial licence for self-hosting, modification, rebranding, APK distribution (#56/#58, G-LIC-1/2, G-APK-1) | Owner + counsel |
| Refund terms | Restaurant refund obligation + customer refund/grievance policy (G-REF-1/2) | Owner + counsel |
| Gateway build | Fork is 96 commits behind upstream; #86 residual-gap patch is local only; container image provenance (#82); SonarCloud findings untriaged (#30) | Owner / lead |
| Supply chain | `next`/`next-auth` critical advisories (T-20) — separate upgrade PR | Lead (separate PR) |
| Ops | Production DB migration baselining (DATABASE_MIGRATIONS.md §4), encrypted off-host backups + restore drill (T-22), live pm2 inventory (T-23), sqlite index check on gateway (T-25) | Owner / ops |
| UAT | Authorised isolated staging with non-production credentials, on-device observer test without money, then controlled micro-payments with documented reconciliation | Owner |

## Exact steps before activation

1. Human review of PR #29 (this branch) and CI green on GitHub.
2. Resolve the licence (G-LIC-1) or decide to stop using the fork commercially.
3. Pick ONE pilot restaurant. Obtain bank confirmation (P2M, thresholds), KYC proof of account ownership, signed refund terms.
4. Deploy the app **with the flag off**; baseline production migrations per DATABASE_MIGRATIONS.md on a restored copy first, then `prisma migrate deploy`; install the pg-worker cron (DEPLOYMENT_AND_ROLLBACK.md).
5. On the gateway: configure Flavrly's webhook endpoint with the Standard Webhooks envelope (not `legacy_format=1`) so `paidAmountPaise` is signed; run the T-25 index check.
6. Super-admin onboards the receiving account (creator ≠ verifier) and per-restaurant gateway credentials.
7. Staging UAT on an authorised isolated environment (repeat STAGING_UAT_REPORT.md scenarios there).
8. Real-money micro-pilot (explicit owner authorisation): small amounts, daily statement import, daily reconciliation report signed off; rollback = flag off (in-flight payments keep reconciling).
9. Owner records the go/no-go decision here.
