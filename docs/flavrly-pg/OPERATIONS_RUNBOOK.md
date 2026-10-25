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
| 18a | Held paid orders | `E.kind='RELEASE_HELD' AND status='OPEN'` older than 15 min | any → nudge the restaurant (§3.13) |
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
2. Contact the customer. On the platform PG ops page (`/platform/youpi/ops`), exception row → **Start refund…** (amount defaults to the credit; it cannot exceed the bank-confirmed money). This creates a PENDING MANUAL_BANK refund (`POST /api/platform/youpi/refunds`).
3. A **different person** (a restaurant admin) approves it on the merchant PG page (`/admin/flavrly-pg`, Refunds), the restaurant sends the money from its bank account, and the bank's refund reference (UTR/RRN) is entered to complete it. When the statement with that DEBIT is imported, the refund is linked to it automatically (BANK_RECONCILIATION_SPEC §6a).
4. Never delete the second credit. Close the exception with a resolution that references the refund id.

### 3.5 Customer says "paid" but the order is pending
1. Look up the order and attempt: `A.state`, `observedUtr`, evidence rows.
2. If OBSERVED, wait for bank evidence. Ask the restaurant to import today's statement, or find the credit by UTR in its bank app. The restaurant enters it as a manual credit, which a second user must approve.
3. If AWAITING_PAYMENT, ask for the UTR. A customer-supplied UTR or screenshot is **never** proof by itself (master prompt §1.5). Match it against bank evidence only.
4. If the credit arrived after the attempt expired/failed (LATE_PAYMENT exception):
   - **Order still unpaid and not cancelled** (PAYMENT_PENDING / PAYMENT_FAILED) and the customer still wants the food: exception row → **Accept late payment…** (super admin A proposes). A **different** super admin approves in "Dual-control actions awaiting a second super admin". Approval moves no money: the order appears on the merchant PG page under "Paid orders waiting for your confirmation". The **restaurant** confirms (payment captured, order sent to the kitchen, never auto-accepted) or declines (order cancelled → refund).
   - **Order cancelled, or the restaurant declined, or a refund is preferred**: exception row → **Start refund…** (kind LATE_PAYMENT), then §3.4 steps 3-4.
   - Accepting is refused automatically for a cancelled or already-paid order, while a refund of that credit is in progress, or when a coupon/wallet/bonus/free gift of the order was already given back.
5. Reply to the customer within the support SLA. Never promise an automatic reversal.

### 3.6 UTR missing
1. Gateway status has no UTR (known upstream behaviour). The UTR comes from the signed webhook body (D5).
2. If the webhook was lost (#86), the attempt stays OBSERVED. Get the UTR from the bank statement row and allocate through the manual dual-control flow (ops page, "Manual allocation"). If the credit is up to 99 paise above the order amount (fork paise offset; the signed payable amount came only in the lost webhook), the manual allocation accepts it and records that amount as the payable. Anything outside `expected < credit <= expected + 99` is refused.
3. `E.kind='MISSING_UTR'` is closed only by an allocation or by an explicit write-off decision from the owner.

### 3.7 Refund dispute
1. Open a `PgRefundRecord`, or find the existing one. Gather order, allocation, bank credit and refund evidence (bank reference of the outgoing transfer).
2. If the customer raised an NPCI/UDIR complaint through their bank, the restaurant's bank handles it. Provide evidence on request. Never fabricate a reference.
3. If the refund failed (#15), retry through the bank.
4. If the **bank reversed a customer credit** (chargeback): ops page → **Propose bank reversal…** with the bank transaction id and the bank's evidence; a different super admin approves. The credit becomes REVERSED, its allocation is released, a REVERSAL exception opens; the order and payment are not changed automatically (owner decides recovery/refund). A reversal is booked once (ledger dedupe).

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

### 3.12 Stuck payment attempt (REVIEW_REQUIRED / CREATE_UNKNOWN that will not resolve)
1. The worker re-probes CREATED/CREATE_UNKNOWN attempts every 90 s and recovers the checkout URL of a session the gateway did create, so most resolve within minutes. STALE_PENDING is raised after 30 min.
2. Check the gateway for the attemptKey. If there is **no** payment evidence at all, exception row → **Void attempt…** (super admin A); a different super admin approves. The server refuses the void if any observation, UTR, signed payable amount, bank credit allocation or gateway success exists, and re-checks at approval. The attempt becomes CANCELLED, its exceptions are resolved, and the order goes PAYMENT_FAILED so the customer can pay again.
3. If evidence exists, do not void: reconcile it (§3.5/§3.6).

### 3.13 Paid orders held for restaurant confirmation (RELEASE_HELD)
1. A capture more than `FLAVRLY_PG_STALE_RELEASE_MINUTES` (default 90) after the order was placed is **not** sent to the kitchen: it stays PAYMENT_PENDING with a RELEASE_HELD exception, and the customer sees "Payment confirmed. The restaurant is confirming your order". Accepted late payments (§3.5) land in the same list.
2. The restaurant admin decides on `/admin/flavrly-pg` → "Paid orders waiting for your confirmation": **Confirm** (order RECEIVED, never auto-accepted) or **Decline** (order cancelled; the exception stays ACKNOWLEDGED in the ops queue with "refund the customer").
3. Ops follow-up for a declined order: exception row → **Start refund…** (kind ORDER for a stale release, LATE_PAYMENT for a declined late payment), then §3.4.
4. Escalations: "order not accepted" counts from the moment the order reached RECEIVED, not from placement.

### 3.14 Dead letters
1. Ops page → "Dead letters" lists dead outbox rows and dead-lettered gateway webhooks with their last error.
2. Fix the cause first, then **Requeue…** (single super admin, audited as `pg.dead_letter.requeue`, ledger `OUTBOX_REQUEUED` / `WEBHOOK_REQUEUED`, exception resolved). Requeue moves no money: ORDER_RELEASE still requires CAPTURED money, a webhook only records an observation. A webhook body already redacted by retention cannot be replayed.

### 3.15 Unpaid orders (automatic)
- A PG order PAYMENT_PENDING with no attempt that can still become money for 30 min (`FLAVRLY_PG_ORPHAN_ORDER_MINUTES`) goes PAYMENT_FAILED (pg-worker stage `orders`); the customer can retry, which moves it back to PAYMENT_PENDING with the new attempt.
- A gateway FAILED/EXPIRED status fails the order at once when no other attempt is live.
- A PAYMENT_FAILED PG order untouched for 24 h (`FLAVRLY_PG_UNPAID_CANCEL_HOURS`) is cancelled (CANCELLED_BY_ADMIN, "Unpaid Flavrly PG order closed automatically"); coupon, wallet amount, loyalty points, signup bonus and free gift come back once. A credit after that is a LATE_PAYMENT → refund.
- While the gateway still reports a session live, expiry waits up to 2 h past the session window.

## 4. Daily checks (until a metrics stack exists)
- Open exceptions by kind (`E`).
- Signals #10, #11, #12 and #18.
- `jobs.log` errors.
- Gateway `/health` (`runtime.patched: true`).

## 5. Data protection in operations
- Never paste UTR, payer VPA, phone numbers or webhook bodies into chat, tickets or commits. Refer to records by id.
- Evidence files live under `~/flavrly-pg-evidence/`, never `/tmp` (it is wiped on reboot).
- **Backups (T-22).** `deploy/backup.sh` uploads off-host only an encrypted copy. Set `BACKUP_AGE_RECIPIENT`
  (preferred) or `BACKUP_GPG_RECIPIENT` in the cron environment; the private key stays offline with the owner. With
  `RCLONE_REMOTE` set and no recipient, the script keeps the local dump but refuses the upload and exits 3
  (override only with `BACKUP_ALLOW_PLAINTEXT_OFFHOST=1`). Owner action: delete any older **plaintext**
  `rm-*.dump.gz` already on the remote (the script now uploads only `*.age`/`*.gpg`; the remote retention sweep
  removes old files by age within 7 days daily / 28 days weekly).
- **Restore drill (T-22), quarterly and before every schema release:** on a non-production server/port run
  `DB_HOST=… DB_PORT=… DB_USER=… DB_NAME=<prod db name> BACKUP_AGE_IDENTITY=<key file> deploy/restore-drill.sh flavrly_drill_<yyyymmdd>`.
  It refuses the production DB name, restores the newest backup (decrypting if needed), prints counts for
  `Order`, `Payment`, `PgPaymentAttempt`, `PgAllocation`, `PgFinancialEvent`, fails on a duplicate
  `PgAllocation.bankTransactionId`, and drops the database unless `--keep`. Record the output and the restore time in
  `~/flavrly-pg-evidence/<date>/restore-drill.md`. The fuller manual checklist is DEPLOYMENT_AND_ROLLBACK.md §5.
- **Demo process (T-23).** Root `ecosystem.config.js` pins `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false` on `flavrly-demo`
  (pm2 `env`, which wins over the `.env` files Next.js loads from the shared `apps/web`). It takes effect only when the
  demo is (re)started from the ecosystem file: `pm2 startOrReload ecosystem.config.js --only flavrly-demo --update-env`.
  Verify with `pm2 env <demo id> | grep FLAVRLY_PG` and confirm `deploy/flavrly-jobs.cron` has no line for the demo
  host. Still an owner check: run `pm2 ls` and record which ecosystem is live (`rm-web` from
  `deploy/ecosystem.config.cjs`, or `flavrly-prod`/`flavrly-demo`); `scripts/deploy-remote.sh` restarts only `rm-web`
  (`PM2_APP`). Neither file has been deleted.
