# Flavrly PG — operations runbook

Owner: Agent G. Scope: master prompt §22.

There is no metrics stack (Prometheus/Grafana) in the repo today. Signals come from:
- (a) `pg-worker` JSON and `pg.worker.metrics` log lines in `/var/log/restaurant-manager/jobs.log` (Agent B's route);
- (b) read-only SQL against production Postgres, run as a read-only role;
- (c) the gateway `/health` on loopback.

Dashboards are therefore saved SQL queries plus a log tail until a metrics stack exists. That is an OPEN engineering item.

> **Every threshold below is INITIAL — calibrate from measured baseline.** No production
> baseline exists, because PG checkout is off. After the pilot, record 14 days of p50/p95 per
> metric in `~/flavrly-pg-evidence/<date>/pg-baseline.md` and re-set each threshold to roughly p99 × 1.5.

Times are IST on the VPS. Escalation: on-call engineer → owner (human). Money-affecting decisions always go to the owner.

## 1. Emergency switches

| Switch | Effect | How |
|---|---|---|
| Global: `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` unset/false | No NEW Flavrly PG checkout. Webhook, status, sweep and `pg-worker` keep reconciling in-flight attempts. | Edit `apps/web/.env`, then `pm2 restart <app> --update-env`. Verify that checkout no longer offers Flavrly PG. |
| Per restaurant: `PgReceivingAccount.disabledForNewAt` / `SUSPENDED` | No new sessions for that account. Reconciliation continues (D7). | Platform PG admin (Agent F). Audit entry required. |
| Gateway hard stop | All gateway sessions stop. Observers queue on the phone. | `pm2 stop youpi-pg`. Use only for compromise. Flavrly attempts then go to CREATE_UNKNOWN/REVIEW and must be resolved manually. |
| Cron stop | Stops automatic reconciliation. **Avoid**: it delays order release. | Comment the line in `/etc/cron.d/flavrly-jobs`. |

## 2. Metrics and alerts

`A` = `PgPaymentAttempt`, `E` = `PgReconException` (status `OPEN`), `B` = `PgBankTransaction`.

| # | Signal (§22) | Source / query | Alert (INITIAL — calibrate from measured baseline) |
|---|---|---|---|
| 1 | Payment creation failures | `A.state IN ('FAILED','CREATE_UNKNOWN')` created in the last 15 min ÷ all attempts created | > 20 % over ≥ 5 attempts, or any CREATE_UNKNOWN older than 10 min |
| 2 | Checkout redirect failures | `log` lines from the create path with a receiver-readback mismatch or no `checkoutUrl` (youpi-api) | ≥ 3 in 15 min |
| 3 | Merchant-account mismatch | `E.kind IN ('RECEIVER_MISMATCH','WRONG_ACCOUNT')` | **any** → page immediately and disable that account for new sessions |
| 4 | Observer heartbeat | gateway admin: device `last_heartbeat_at` | no heartbeat for 15 min during business hours |
| 5 | Invalid webhook signatures | webhook route 401 count (access log / `log.warn`) | ≥ 10 in 5 min (attack or secret drift) |
| 6 | Webhook lag | `metrics.inboxLagSec` | > 120 s |
| 7 | Webhook retries | `metrics.inboxRetrying` | > 10 |
| 8 | Dead-letter size | `metrics.inboxDeadLettered + metrics.outboxDead`, and `E.kind IN ('WEBHOOK_DEAD_LETTER','OUTBOX_DEAD_LETTER')` | **any** new item |
| 9 | Reconciliation latency | `now() - A.updatedAt` for `A.state='OBSERVED'` | p95 > 30 min during banking hours (bank evidence arrives by CSV, D4) |
| 10 | Bank feed freshness | `max(PgStatementImport.createdAt)` per active receiving account | > 24 h with ≥ 1 OBSERVED attempt pending (no live feed exists, D4) |
| 11 | Stale pending | `A.state IN ('AWAITING_PAYMENT','OBSERVED') AND createdAt < now()-interval '2 hours'`, and `E.kind='STALE_PENDING'` | > 0 older than 2 h |
| 12 | Unmatched bank credits | `B.status='UNMATCHED' AND createdAt < now()-interval '1 hour'`, and `E.kind='UNMATCHED_CREDIT'` | > 0 for 1 h |
| 13 | Duplicate transaction attempts | `E.kind IN ('DUPLICATE_CREDIT','AMBIGUOUS_MATCH')` | any |
| 14 | Overcollections | `E.kind='OVERCOLLECTION'` | any → refund workflow (§3.4) |
| 15 | Refund failures | `E.kind='REFUND_FAILED'`, and `PgRefundRecord` without `completedAt` after 48 h | any |
| 16 | Cron/worker failures | no `pg.worker.metrics` line for 5 min; `pg.worker.stage_failed` lines; `PgJobLease` past expiry | 5 min silence, or ≥ 3 stage failures in 15 min |
| 17 | DB locks | `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'`; `pg_locks` not granted > 30 s | > 0 waiting > 30 s |
| 18 | Financial report mismatch | daily: Σ `PgAllocation.amountPaise` (not reversed) per account per day vs Σ CREDIT `B.amountPaise` ALLOCATED, and vs `Payment` CAPTURED for providerName='youpi' | any non-zero difference |

## 3. Runbooks

Every runbook ends the same way:
- Record what happened in `~/flavrly-pg-evidence/<date>/incident-<slug>.md`: timeline in IST, queries run and outputs, decisions and approver.
- Never mark money CAPTURED by hand outside `allocateBankCredit()` and the dual-control manual flow (D3/D13).

### 3.1 Gateway outage
**Symptoms:** create failures (#1), CREATE_UNKNOWN growing, `curl -fsS http://127.0.0.1:6100/health` fails.

**Steps:**
1. Turn the global flag OFF (§1).
2. Check `pm2 ls`, then `pm2 logs youpi-pg --lines 200`. Check disk (`df -h`) and the SQLite WAL size.
3. Restart once with `pm2 restart youpi-pg --update-env`. If it still fails, use the gateway rollback in DEPLOYMENT_AND_ROLLBACK.md §4.
4. After recovery, the worker sweep probes each CREATE_UNKNOWN/AWAITING attempt by attemptKey. Leave it to drain, and check that #11 returns to 0.
5. Customers who paid during the outage: their bank credits arrive in the next statement import, where they match or become UNMATCHED_CREDIT (§3.5).

### 3.2 Bank feed outage (statement import not possible)
1. There is no live feed by design (D4). Attempts remain OBSERVED, and **no order is released**, which is correct.
2. Tell the affected restaurants that orders paid by direct UPI are held. Offer COD or PhonePe as an alternative. Consider turning the flag OFF if the hold is longer than 2 h.
3. When statements are available, the operator imports the CSV (PG admin). Duplicate rows are idempotent, deduplicated by file SHA-256 and row hash.

### 3.3 Wrong receiving account
**Symptoms:** #3 fires, or a merchant reports money arriving in another account.
1. Immediately set `disabledForNewAt` on **both** accounts and turn the global flag OFF.
2. Freeze the evidence: export the relevant attempts, evidence and gateway status readback.
3. Do not move money in software. The owner contacts both restaurants and banks, and refunds go through the D13 manual refund flow with evidence and two approvers.
4. Root-cause the binding: VERIFIED `PgReceivingAccount`, gateway merchant, VPA change audit (threat model T-04/T-06).
5. Re-enable only after re-verification.

### 3.4 Duplicate payment / overcollection
1. `E.kind IN ('OVERCOLLECTION','DUPLICATE_CREDIT')`. Confirm two distinct bank credits exist, with distinct `bankReference` values. One allocation fulfils the order; the second stays as an exception.
2. Contact the customer and start a refund via `PgRefundRecord`, method MANUAL_BANK, with the bank reference as evidence and a second approver.
3. Never delete the second credit. Close the exception with a resolution that references the refund record.

### 3.5 Customer says "paid" but the order is pending
1. Look up the order and attempt: `A.state`, `observedUtr`, evidence rows.
2. If OBSERVED, wait for bank evidence. Ask the restaurant to import today's statement, or find the credit by UTR in its bank app. The restaurant enters it as a manual credit, which a second user must approve.
3. If AWAITING_PAYMENT, ask for the UTR. A customer-supplied UTR or screenshot is **never** proof by itself (master prompt §1.5). Match it against bank evidence only.
4. If the credit exists but the order was cancelled: the LATE_PAYMENT exception leads to a refund or a re-placed order, at the owner's choice.
5. Reply to the customer within the support SLA. Never promise an automatic reversal.

### 3.6 UTR missing
1. Gateway status has no UTR (known upstream behaviour). The UTR comes from the signed webhook body (D5).
2. If the webhook was lost (#86), the attempt stays OBSERVED. Get the UTR from the bank statement row and allocate through the manual dual-control flow.
3. `E.kind='MISSING_UTR'` is closed only by an allocation or by an explicit write-off decision from the owner.

### 3.7 Refund dispute
1. Open a `PgRefundRecord`, or find the existing one. Gather order, allocation, bank credit and refund evidence (bank reference of the outgoing transfer).
2. If the customer raised an NPCI/UDIR complaint through their bank, the restaurant's bank handles it. Provide evidence on request. Never fabricate a reference.
3. If the refund failed (#15), retry through the bank. Book a reversal only once; the append-only ledger enforces this.

### 3.8 Database rollback
1. Prefer a **code** rollback (DEPLOYMENT_AND_ROLLBACK.md §4). The schema is additive.
2. A data restore needs owner approval:
   - Restore to a **new** database (§5 drill steps).
   - Compute the gap (records after the backup time) from bank statements and gateway sessions.
   - Switch `DATABASE_URL`.
   - Re-import statements.
   - Reconcile every attempt in the gap.
3. Never restore over the live database in place.

### 3.9 Compromised API key / webhook secret / cron secret
1. Turn the global flag OFF.
2. Rotate on the gateway (merchant key or webhook secret, in the fork admin, which supports a rotation overlap). Then save the new values via the platform config (`/api/platform/youpi/config`); the SSRF validator applies.
3. `INTERNAL_CRON_SECRET`: edit `.env`, then `pm2 restart --update-env`. Cron re-reads `.env` on every run.
4. Review 7 days of webhook events for unexpected IPs or bodies and invalid signatures (#5). Any attempt captured in that window gets its bank evidence re-checked.
5. Record the rotation time and approver. Rotating live secrets needs the controlled procedure in master prompt §24.

### 3.10 Observer compromise (phone lost, rooted or tampered)
1. In the gateway admin, unlink the device. Its signing key stops verifying.
2. Observations from that device after the suspected time are hints only. Nothing they produced is captured without bank evidence (D2/D3). List the affected OBSERVED attempts and require statement evidence.
3. Re-pair a clean device. Verify the installed APK SHA-256 is `a024b251…162d` and the signer cert is `66c4b38d…e27e` (UPSTREAM_PARITY_AND_ISSUES.md #61).

### 3.11 Emergency disablement (any unexplained money anomaly)
1. Turn the global flag OFF. That is enough to stop new exposure.
2. Keep reconciliation running. Do not stop cron or the gateway unless it is compromised.
3. Open an incident file and notify the owner.
4. Re-enable only through the DEPLOYMENT_AND_ROLLBACK.md §7 conditions.

## 4. Daily checks (until a metrics stack exists)
- Open exceptions by kind (`E`).
- Signals #10, #11, #12 and #18.
- `jobs.log` errors.
- Gateway `/health` (`runtime.patched: true`).

## 5. Data protection in operations
- Never paste UTR, payer VPA, phone numbers or webhook bodies into chat, tickets or commits. Refer to records by id.
- Evidence files live under `~/flavrly-pg-evidence/`, never `/tmp` (it is wiped on reboot).
