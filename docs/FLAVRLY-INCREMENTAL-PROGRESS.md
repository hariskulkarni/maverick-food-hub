# Flavrly — Incremental Progress Register

Tracks the INCREMENT prompt pack (`Flavrly_Claude_CLI_Incremental_Prompts_and_Security.txt`).
One increment per run. Payment gateway/method selection and Razorpay/provider-specific work are **DEFERRED OWNER DECISION**.

Status legend: NOT STARTED · IN PROGRESS · IMPLEMENTED/UNVERIFIED · VERIFIED · BLOCKED EXTERNAL · DEFERRED OWNER DECISION.

---

## INCREMENT-00 — Clean baseline and dependency hygiene — **VERIFIED** (local; DB-dependent items noted)
- **Scope IDs:** REQ-01; SEC-12.
- **Branch:** `feat/increment-00` off `main` @ 35fe8de. Local commit only (not pushed, not deployed).
- **Node/npm:** documented — `engines` (node `>=20 <23`, npm `>=10`) in `apps/web/package.json` + `.nvmrc` = `20` (matches CI `node-version: 20`). Verified on node v20.20.2 / npm 10.8.2.

### Defects found at HEAD and fixed
1. **SEC-12 — tracked machine-local dependency symlink.** `apps/web/node_modules` was tracked in git as an **absolute symlink** to `/Users/bunny../Documents/Claude/Projects/Flavrly/apps/web/node_modules` (confirmed `git ls-files` → 1 entry; dangling on any other machine). Removed from version control (`git rm --cached` + deleted the symlink); a real `node_modules/` directory is now correctly git-ignored (`git check-ignore` passes).
2. **Lockfile drift — missing `web-push`.** `web-push`/`@types/web-push` were in `package.json` but **absent from `package-lock.json`** (so `npm ci` would fail). Re-synced via `npm install`; `web-push` now present in the lockfile. (`leaflet-draw` was already locked.)

### Changed files
- `apps/web/package.json` (added `engines`).
- `apps/web/package-lock.json` (re-synced; adds `web-push`).
- `.nvmrc` (new, `20`).
- Removed tracked `apps/web/node_modules` symlink.
- `docs/FLAVRLY-INCREMENTAL-PROGRESS.md` (this file), `docs/FLAVRLY-ROLE-ROUTE-INVENTORY.md` (new).
- No product/behavior code changed.

### Checks (actual commands + results, isolated worktree)
| Check | Command | Result |
|---|---|---|
| Fresh-checkout install | `npm ci` (apps/web) | PASS (installs cleanly from synced lockfile) |
| Prisma client | `npx prisma generate` | PASS |
| Web typecheck | `npx tsc --noEmit` | PASS (clean) |
| Web lint | `npx next lint` | PASS (0 errors; pre-existing `no-explicit-any` warnings only) |
| Web unit/integration | `npx vitest run` | PASS — 110 files, **1065 tests** |
| Web production build | `npx next build` | Compile + typecheck PASS; **static-page generation requires a reachable Postgres** (fails locally with `Can't reach database server at localhost:5432`). Env-only; passes in CI/VPS where `DATABASE_URL` is set. Marked IMPLEMENTED/UNVERIFIED for the full-build step locally. |
| Rider app install | `npm install` (apps/rider-native) | PASS |
| Rider app typecheck | `npx tsc --noEmit` (apps/rider-native) | PASS (clean) |

### Migration effects
- None. No schema change in this increment.

### External dependencies / unverified
- **Disposable Postgres** required for: full `next build` static generation, and for the DB-backed customer→kitchen→rider acceptance scenario (see role/route inventory). Not provisioned in this run → those remain UNVERIFIED.
- `npm audit`: **31 vulnerabilities (4 critical, 19 high, 7 moderate, 1 low)** in the dependency tree. Recorded as a pending risk; dependency remediation is **not** in INCREMENT-00 scope (avoid behavior changes), revisit in INCREMENT-23 (release retest) or a dedicated dependency-upgrade pass.

### Security register — status (reproduce/remediate in later increments; NOT fixed here)
- SEC-01 Google OAuth staff bypass — PENDING (INCREMENT-01).
- SEC-02 Private rider media in public namespace — PENDING (05).
- SEC-03 Native token revocation gap — PENDING (03).
- SEC-04 Session validation fails open — PENDING (02).
- SEC-05 Release cleartext traffic — PENDING (04).
- SEC-06 Mobile demo targets production — PENDING (04).
- SEC-07 Upload byte validation — PENDING (06).
- SEC-08 CSP unsafe-inline/eval — PENDING (07).
- SEC-09 CSRF/proxy coverage — PENDING (07,19).
- SEC-10 Break-glass staff access — PENDING (01/02).
- SEC-11 Financial integrity (tips/invariants/onboarding/replay) — PENDING (11-13,19).
- **SEC-12 dependency symlink + lockfile — REMEDIATED this increment (local commit; not yet pushed/merged).**

### Acceptance gate
- Fresh-checkout install + web/rider checks PASS; no machine-local dependency path tracked. ✔
- One customer→kitchen→rider flow mapped to files + a reproducible (DB-backed) scenario. ✔ (`docs/FLAVRLY-ROLE-ROUTE-INVENTORY.md`)
- Security register findings recorded as pending (not claimed fixed). ✔

### Next increment
**INCREMENT-01 — Web OAuth / staff identity policy** (REQ-16; SEC-01, SEC-10): customer-only Google login by default, refuse privileged accounts on customer OAuth, reject suspended/deleted on every provider, with an auth-level regression test.

### Commit
- Local commit on `feat/increment-00`: `fd0000f`. Not pushed, not merged, not deployed.

---

## INCREMENT-01..23 — NOT STARTED
(Run one per invocation per the prompt pack. Payment rail + Razorpay/provider adapters DEFERRED OWNER DECISION.)
