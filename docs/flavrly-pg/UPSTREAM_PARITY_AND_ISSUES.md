# Flavrly PG — upstream parity and issue matrix

Owner: Agent G. Checked on 2026-10-24. Every statement below comes from a command that was run and its output read. Where something could not be checked, the text says so.

## 1. Baselines

| Item | Value | How it was checked |
|---|---|---|
| Upstream repo | `youpi-pg/YouPI-PG` | `git remote -v` in the local checkout |
| Upstream `main` | `d7b07414d803094525ceedd5cf81e8a38157263e` (2026-10-22 11:16 +0530, "fix(security): repair PR #78 merge defects") | `git rev-parse origin/main` |
| Our fork | `flavrly/pg-hardening` @ `7720b49cbd39ee9fcf6677c174f79dc654edfd05` | local read-only checkout `Flavrly/flavrly-pg/repo` |
| Fork vs main | **69 commits ahead, 96 behind**. Merge base `3fe33ce` (2026-10-20) | `git rev-list --left-right --count flavrly/pg-hardening...origin/main` |
| Deployed gateway | fork `7720b49` on `148.230.66.124:/opt/youpi-pg`, 2026-10-22 22:44 IST, Node 24.22.1. **This comes from the deploy record and was not independently verified.** No production host was contacted. | `flavrly-pg/DEPLOY-pg-hardening.md` |
| Historical #60 fix `3f5acc4` | **In upstream main: yes. In our fork: NO.** `git cherry` marks it as not applied. The fork has its own equivalent fixes (see #60 below). | `git merge-base --is-ancestor`, `git cherry` |
| Historical #61 fix `cfec0e4` | **In upstream main: yes. In our fork: NO.** The fork's own listener rewrite differs (see #61). | same |

Consequence: our fork does not contain upstream's #60/#61 commits. It has independently written equivalents, and a code read cannot show those are equivalent. It also lacks the 96 upstream commits since 2026-10-20, which may include other security fixes nobody has reviewed yet. Rebasing or merging upstream main is an open engineering task, and the licence blocker (#56/#58) applies to it.

## 2. Issue matrix

Legend:
- Main = upstream `d7b0741`.
- Fork = `7720b49`.
- Deployed = the deploy record says fork `7720b49` is deployed; not verified.
- File:line references are in the named tree.

### #22 / #60 — verification pipeline failures and missing rawText must not fall through to amount-only attribution

- **State:** #22 CLOSED (2026-10-20). #60 **OPEN**. Fix commit `3f5acc4` is cited in a maintainer comment, but the issue has not been closed.
- **Main:**
  - rawText is required at `apps/payment-api/src/routes/pollers.routes.js:81-89` (`/pollers/events`) and `:365-374` (Android).
  - The response is 200 only for `VERIFIED` (`:128`, `:426`). Everything else returns 400: "Invert check … NEVER fall through" at `:194-203` and `:463-471`.
  - One deliberate exception remains: stage-4 `NO_ACTIVE_SESSION` calls `attributionEngine.processObservation` for a LATE_UNMATCHED manual-review ticket (`:149-190`). The comment says this "is NOT a settlement route". We did not verify that inside `attribution-engine.js`.
  - Unique indexes: `packages/db/src/schema.sql:138,161` and `sqlite-schema.sql:141,164` (attributed UTR, attributed observation).
- **Fork:**
  - rawText is required at `pollers.routes.js:202-208` and `:501-511`.
  - Pipeline results map onto HTTP only through `respondToPipeline` (`:51-110`). Only `VERIFIED` gives `accepted:true`, at `:66-74`.
  - The route never calls the attribution engine directly. `grep processObservation` returns no hit in the route.
  - Unique `(receiving_account_id, bank_reference_number)` index for attributed observations: `packages/db/src/migrations/verification-hardening.js:31-37`, plus `schema.sql:163,166`.
  - **Caveat:** the migration creates the unique indexes inside `try/catch` and only *warns* on failure (`verification-hardening.js:35-37,43-45`). Whether they exist in the deployed SQLite file is **not verified**.
- **Deployed:** fork, per the deploy record.
- **Flavrly-side mitigation:**
  - A gateway observation is never capture (decision D2).
  - CAPTURED is written only by `allocateBankCredit()` with independent bank evidence (D3, Agent C).
- **Remaining blocker:**
  - Run `SELECT name FROM sqlite_master WHERE name LIKE 'idx_%attributed%'` on the deployed DB (operator, read-only).
  - Today, `youpi-reconcile.ts:53-97` (current code, pre-D3) still captures from gateway status + UTR. That is finding T-01 in SECURITY_THREAT_MODEL.md and stays open until C's engine lands.

### #24 / #61 — the Android listener must send an authenticated package identity; the rebuilt APK must match reviewed source

- **State:** #24 CLOSED. #61 **OPEN**. Fix `cfec0e4` is cited, not closed.
- **Main:**
  - `ApiClient.sendObservation(..., String packageName)` 7-argument overload at `apps/android-observer-app/.../ApiClient.java:135`. It puts `rawNotification.package` at `:148-149,159`.
  - The listener filters on `ALLOWED_BANKING_PACKAGES` (`PaymentNotificationListenerService.java:20,76-77`) and calls the 7-argument form at `:138`.
  - The server requires the package on `/pollers/android/events` (`pollers.routes.js:343-352`, `requirePackage:true` at `:476`) and checks the allowlist (`:355-363`, `packages/common/src/upi-providers.js:372-387`).
  - **Gap:** `/api/v1/observers/sms` registers with `requirePackage:false` (`:477`). On that route, a notification-shaped body without a package is not rejected by the route.
- **Fork (`com.flavrly.observer`):**
  - The listener rejects packages that are not allowlisted before reading content (`PaymentNotificationListenerService.java:27-28`).
  - It builds the payload with `rawNotification.package` (`ApiClient.java:120-138`) and enqueues it to a disk outbox (`:53`).
  - Every request is HMAC-signed: `HMAC-SHA256(deviceKey, body:ts:nonce)` at `ApiClient.java:254-264`.
  - The allowlist is generated from `packages/common/src/observer-sources.js` into `ObserverPolicy.java:22-37`. Running the sync during our build produced **no source diff**.
  - Server side:
    - The device signature, ±60 s and single-use nonce are checked at `pollers.routes.js:321-346,461`.
    - Notification events go through the pipeline's package allowlist (`packages/core/src/verification-pipeline.js:409-411`). Missing or unlisted package → `NOTIFICATION_PACKAGE_NOT_ALLOWED`.
    - rawText is required at `:503-511`.
    - Non-VERIFIED results are never `accepted:true` (`:66-74`).
  - "Signed package" means the package string is inside a body that is HMAC-authenticated with the paired device key. **It is not attested by Android.** A rooted or compromised paired device can claim any allowlisted package. So the package proves transport from a paired device, not origin.
- **APK provenance (built 2026-10-24 in an isolated worktree `flavrly-pg/wt-g-apk`, detached at `7720b49`):**
  - Toolchain: the project's own `node scripts/build-android-apk.js` (javac 17.0.20 Temurin, d8/aapt/zipalign/apksigner from build-tools 36.0.0, `android-36.1/android.jar`).
  - Signing: a **throwaway key** via `ANDROID_KEYSTORE_PATH` in the scratchpad. The release keystore under the fork's `data/.secrets` was **not used or read**. That directory does not exist in the isolated worktree. Exit 0, log in `~/flavrly-pg-evidence/2026-10-24/agent-g/apk-build.log`.
  - Built APK SHA-256: `64bdfe4fc00054f78d66965a503bc8a0e2bc768042a93102a8142f6d3210ba0b` (307,684 B). Signer cert SHA-256 `d2505f2d…59ff` (throwaway).
  - Committed APK at `7720b49`: all three copies (`apps/android-observer-app/`, `apps/payment-api/public/`, `apps/merchant-admin/public/`) are `a024b251dcfd83ba9abe114cf2f283e936358f311e8abcca8ebb784b7191162d` and match their `.sha256` files. Release signer cert SHA-256 `66c4b38d9e37c1ed7c0115b2b64c7326d4ec5c64649dde6ca98e3e2ff8b4e27e` (CN=Flavrly SMS Gateway).
  - **Why the hashes differ, and what does match:**
    - The whole-file SHA-256 cannot match, because APK v2/v3 signing embeds a signature block made with the signer's private key.
    - Every zip entry was compared by SHA-256. All 7 entries are byte-identical **except `META-INF/FLAVRLY_.RSA`**, which is the signature. That includes `classes.dex` `42070a21…6dc5`, `AndroidManifest.xml` and resources.
    - So the committed APK's code and resources reproduce exactly from source `7720b49` with this toolchain. Evidence: `apk-compare.txt`.
  - Upstream main's committed `youpi-sms-gateway.apk` is `959218223e75…51601` (matches its `.sha256`), signer `c290904b…95bb` (CN=YouPI SMS Gateway). It is a different app id and signer, so it is not interchangeable with ours.
  - **Not verifiable here:** the APK actually installed on merchant phones. There is no device and no `adb`, and the deploy record names v1.1.1 / versionCode 3 only. Operator step: on each paired phone, `adb shell pm path com.flavrly.observer`, pull the APK, `sha256sum` it, and compare against `a024b251…162d` and the signer cert `66c4b38d…e27e`.
- **Flavrly-side mitigation:** a notification or observation is only a hint. Capture needs bank evidence (D2/D3).
- **Remaining blocker:**
  - Device-installed hash and signer check (human).
  - Licence permission to distribute a modified APK (COMPLIANCE APK-1).
  - Release keystore custody and backup (human).

### #86 — a terminal webhook can be lost if the gateway crashes during first delivery

- **State:** OPEN (reporter samirhvbr, confirmed against `d7b0741`).
- **Main:**
  - The terminal status is committed first.
  - The `PAYMENT.SUCCESS` listener then calls `webhookEngine.dispatch` (`apps/payment-api/src/index.js:172-181`).
  - `dispatch` `await fetch(...)`s (`packages/core/src/webhook-engine.js:~131`) and inserts the `webhook_deliveries` row only afterwards (`:153`).
  - A SIGKILL mid-fetch leaves no row, so no retry is possible. This matches the issue.
- **Fork:**
  - `PaymentSessionRepository.transitionToTerminal` (`packages/db/src/repositories/payment-session.repository.js:442`) records the webhook event and deliveries in the same IMMEDIATE transaction through a SAVEPOINT (`webhook.repository.js:201-249,305`).
  - The leased dispatcher has retries and a dead letter.
  - Status writes that bypass `transitionToTerminal` are covered by a sweep that recreates missing terminal events, but **only for sessions completed in the last 15 minutes** (`packages/core/src/webhook-dispatcher.js:447`). Outside that window a bypassing write can still lose its event.
  - **Agent B is independently reproducing #86 against the fork. Their evidence is authoritative; this entry does not duplicate it.**
- **Deployed:** fork, per the deploy record.
- **Flavrly-side mitigation:**
  - The inbound webhook is stored durably before 200 (D10, Agent B).
  - The `pg-worker` reconcile sweep probes in-flight attempts by status regardless of webhooks, so a lost webhook delays recognition rather than losing money.
- **Remaining blocker:**
  - Agent B's crash test result against the fork.
  - Every terminal-write path must go through the outbox. An upstream patch needs licence clearance.

### #89 — merchant ID/key provisioning

- **State:** OPEN. User question: "no options there in admin/merchant create merchant id".
- **Main and fork:** both create exactly one default merchant at boot (`packages/db/src/migrate.js:126` main, `:127` fork). There is no merchant-create route or UI (grep `merchantRepo.create(`).
- **Consequence for Flavrly:** per-restaurant gateway credentials (D7) cannot be issued by the deployed gateway today. The platform shared credential may serve **at most one** VERIFIED binding.
- **Remaining blocker:**
  - Multi-restaurant production needs either an upstream/fork merchant-provisioning feature (licence-gated) or one gateway instance per restaurant. **BLOCKED** for more than one restaurant.

### #70 — P2P/P2M account-freeze risk

- **State:** OPEN, unanswered.
- **Main and fork:** there is no code mitigation, and none is possible. Rate or limit caps (D9) reduce volume but cannot authorise usage.
- **Remaining blocker:** written acquiring-bank P2M approval for each receiving account. COMPLIANCE BANK-1 is **BLOCKED** (human).

### #48 — independent bank transaction reconciliation

- **State:** OPEN (feature request).
- **Main:** not present.
- **Fork:** not present. Observers (SMS, notification, Gmail) are not an independent bank feed.
- **Flavrly side:**
  - `BankTransactionSource` interface, CSV statement import and dual-control manual entry (D4, Agent C).
  - An automatic real-time bank feed is **NOT AVAILABLE**. That is an external blocker: it needs an authorised bank or account-aggregator API.

### #82 — GHCR image visibility and provenance

- **State:** OPEN.
- **Check on 2026-10-24:** an anonymous pull token for `ghcr.io/youpi-pg/youpi-pg` returns `UNAUTHORIZED`, and the manifest `sha-d7b0741` returns HTTP 403. The package is still private.
- **Flavrly:** we do **not** use the upstream image. The gateway is deployed from a git bundle of fork `7720b49` and run under pm2 (deploy record).
- **Remaining:** if containers are ever used, build them internally from a reviewed pinned SHA with an SBOM and a digest pin. Never use `:latest`.

### #56 / #58 — commercial licence

- **State:** both OPEN, with no maintainer licence answer.
- **Main:** see COMPLIANCE_AND_LICENSE_BLOCKERS.md (`package.json` says `"license": "Commercial"`, and there is no LICENSE file).
- **Fork:** rebrands YouPI → Flavrly (`ec8b986`), which is a derivative work.
- **Blocker:** **BLOCKED** until a written licence covers self-hosting, modification, rebranding, SaaS use and APK distribution (human).

### #59 — AI review key (ReviewGround)

- **State:** OPEN.
- **Flavrly:** no LLM key is stored in this repo. Deterministic checks are in CI:
  - gitleaks (unchanged)
  - `npm audit` report
  - CodeQL `security-extended` (`.github/workflows/codeql.yml`, actions pinned by SHA)
  - typecheck, lint and tests
  - migration drift check

  AI review stays optional and supplementary.

### #30 — SonarCloud findings

- **State:** OPEN. The issue body is only a screenshot.
- **Upstream org project:** the SonarCloud public API (`api/issues/search`) for `youpi-pg_YouPI-PG`, `youpi-pg_youpi-pg` and `gxurav1710_YouPI-PG` returns `total: 0`, with no components. No upstream-owned project is visible.
- **Third-party public project `Zaliyo_YouPI-PG`:**
  - It analysed revision `242969c` (upstream "Whatsapp Patched", 2026-10-15) at 2026-10-18 06:16 UTC, nine minutes before #30 was filed. It is probably the source of the screenshot, but **that is not confirmed**.
  - Totals: 910 open issues, of which 100 VULNERABILITY (13 BLOCKER, 2 CRITICAL, 66 MAJOR, 19 MINOR), 96 BUG and 714 CODE_SMELL. 0 hotspots are exposed.
  - BLOCKERs:
    - open redirect + prototype pollution in the `apps/merchant-admin`, `apps/checkout-portal` and `apps/coin-wallet-store` `src/server.js` proxies;
    - reflected XSS in `apps/gmail-observer/src/server.js:92,213,335`.
  - CRITICAL:
    - `jssecurity:S8689` log disclosure, `apps/payment-api/src/services/whatsapp-berry.service.js:152`;
    - `xml:S5322` intent receiver, `AndroidManifest.xml:84`.
  - Raw data: `~/flavrly-pg-evidence/2026-10-24/agent-g/sonarcloud/` (`vulns.tsv`, JSON).
- **Triage status:**
  - `242969c` is an ancestor of both main and our fork. Many of those files have changed since (for example `gmail-observer/src/server.js` +61/−14).
  - Spot check: the fork HTML-escapes the OAuth `error` (`apps/gmail-observer/src/server.js:116`), so that BLOCKER is not reproduced at 7720b49.
  - **The other 99 vulnerabilities have not been triaged against the fork.** Engineering task: run Sonar or CodeQL on fork `7720b49` itself rather than relying on a third party's scan of an older commit.

## 3. What this matrix does not establish

- What is actually deployed was not verified: no production access, by design.
- No device test was possible. The installed APK hash and Android permission behaviour on a real phone are unverified.
- Equivalence between the fork's independent #60/#61 fixes and upstream's `3f5acc4`/`cfec0e4` is argued from code reading, not from running upstream's `verification-fallthrough.test.js` against the fork.
- The 96 upstream commits missing from the fork have not been reviewed.
