# Flavrly PG — Master implementation status & task board

Lead branch: `pg/lead` (base `fix/flavrly-pg-safe-pilot-20261022` @ eebd11f, PR #29).
Contract: [ARCHITECTURE_AND_DATA_FLOWS.md](ARCHITECTURE_AND_DATA_FLOWS.md). Evidence: `~/flavrly-pg-evidence/2026-10-24/` (lead machine).

## Phase 0 baseline (2026-10-24, lead machine, Node v20.20.2, Postgres 16.15 local)
| Step | Result |
|---|---|
| prisma generate / validate | exit 0 / exit 0 |
| prisma db push (fresh DB) | exit 0 |
| typecheck / lint / check:responsive | exit 0 / 0 / 0 |
| test:ci | 137 files, 1304 tests passed |
| build | exit 0 |
| GitHub CI on PR #29 head eebd11f | Web, Security, Rider: SUCCESS |

Baseline findings (fresh, file-level evidence):
- Prisma migrations do not contain the YouPI models (`YoupiFeatureRequest`, `YoupiDailyUsage`); CI uses `db push`, production `deploy/deploy.sh:82` runs `migrate deploy` → schema drift (P1, Agent C).
- Existing vitest suite mocks Prisma entirely; no real-DB test protects money invariants (Agent C/H).
- `youpi-reconcile.ts` requires UTR from status API, which upstream never returns (P0 functional, Agent C).
- Capture guard `findFirst` + `updateMany` is non-atomic across attempts (P0, Agent C).
- Attempt number `count+1` (`payments/online.ts:141`) collides under concurrent starts (P1, Agent A).
- Advisory lock in `jobs/youpi-reconcile-sweep.ts` taken on a pooled connection (P1, Agent B).
- Webhook replay uses the `error` column as claim marker (P1, Agent B).
- Caps keyed by restaurant, slots never released (P1, Agent A).
- Upstream fork deployed (`flavrly/pg-hardening` @ 7720b49) is 96 commits behind upstream main d7b0741 (Agent G/B).

## Task board
| Agent | Scope | Branch | Depends on | Status | Commits | Integration | Open risks |
|---|---|---|---|---|---|---|---|
| Lead | contract, schema v1, money helper, integration, final docs | pg/lead | — | contract done (5355b47, 58c338b) | | — | |
| A | binding, attempts, limits, gateway client | pg/a-core | contract | in progress | | | |
| B | webhook inbox/outbox, leases, #86 fork | pg/b-webhooks | contract | in progress | | | |
| C | migrations, ledger, bank ingest, reconcile engine | pg/c-ledger | contract | in progress | | | |
| D | fulfillment, order release, status UX | pg/d-checkout | contract | in progress | | | |
| E | refunds, settlement, reports | pg/e-refunds | C | queued (wave 2) | | | |
| F | merchant/platform UI, CRM events | pg/f-merchant | C, E | queued (wave 2) | | | |
| G | security, CI, upstream, Android, ops docs | pg/g-security | — | in progress | | | |
| H | independent QA, adversarial, regression | pg/h-qa | integration | queued (wave 3) | | | |
