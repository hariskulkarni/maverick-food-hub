# IAM — Identity & Access Management

Platform-team roles, a capability model, and a Super-Admin console for creating
users and assigning roles. Restaurant staff (ADMIN/KITCHEN), customers, and
riders are **not** managed here — they keep their existing per-restaurant /
OTP flows untouched.

## Roles & capabilities

| Role | What they can do |
|---|---|
| **Super Admin** | Everything, including **IAM across all businesses** — create users, assign/revoke roles, all confidential ops. |
| **Admin Assist** | Runs day-to-day **operations + riders** and can build most things. **Confidential** actions (moving money, deleting restaurants, IAM) are withheld — Stage 3 turns these into approval requests routed to a Super Admin. |
| **Developer** | Full **CMS** access (Discovery CMS, content). Nothing operational or financial. |
| **QA** | **Read** everything built via the CMS + a test/preview capability. No writes, no finance. |
| **Guest** | **Read-only** across the surfaces it can reach. |

The single source of truth is `src/server/permissions.ts` (capability matrix +
`can()` / `pageGateFor()`), unit-tested in `__tests__/server/permissions.test.ts`.

### Capability matrix (summary)

- `platform:view` — open the console (all 5 platform roles)
- `platform:admin` — Super-Admin-only surfaces (analytics, users, audit, security, monitoring, KYC, QR)
- `iam:manage` — create users, assign/revoke roles *(confidential — Super Admin only)*
- `cms:read` / `cms:write` — Discovery CMS + content
- `ops:read` / `ops:write` — orders, live-ops, support, surge, messages, feedback
- `riders:read` / `riders:write` — rider management surfaces
- `finance:read` / `finance:write` — payouts, settlements, COD *(confidential write — Super Admin only)*
- `restaurants:read` / `restaurants:write` — restaurant list (read) / suspend·archive·delete *(confidential write)*
- `qa:test` — exercise preview/test surfaces

## Enforcement (defence in depth)

1. **Login** (`src/server/auth.ts`) — staff + platform roles sign in with email+password; customers/riders use OTP.
2. **Layout** (`src/app/platform/layout.tsx`) — admits any platform role and shows a **capability-filtered nav** (you only see what you can open).
3. **Middleware** (`src/middleware.ts`) — per-surface page gate: redirects a role that lacks the capability for a `/platform/*` path.
4. **Page / API guards** — `requireCapability()` (server components) and `requireCapabilityApi()` (route handlers). Reads need the `:read` capability, writes the `:write` capability. Un-migrated surfaces stay Super-Admin-only (fail-safe).

## The IAM console

`/platform/iam` (Super Admin only). Create a member (name, email, temp
password ≥ 12 chars, role), change a member's role inline, and suspend /
reinstate (suspension force-logs-out every session immediately). Every mutation
is written to the audit log (`iam.user.create`, `iam.role.assign`,
`iam.user.suspend`, `iam.user.reinstate`).

Guardrails: the console manages **only** the four delegated roles. It cannot
mint or edit Super Admins, restaurant staff, customers, or riders, and you
cannot modify your own account there.

## Deploying (schema change)

Adds four values to the `Role` enum — **non-destructive** (existing rows keep
their role). From the Mac repo root:

```
bash scripts/deploy.sh --migrate
```

This pushes, SSHes to the VPS, runs `prisma db push` (applies the enum values),
`rm -rf .next`, rebuilds (regenerates the Prisma client), and restarts pm2.

## Approvals (maker-checker) — Stage 3

When an **Admin Assist** triggers a **confidential** action, it is recorded as a
`PENDING` `ApprovalRequest` instead of running; a **Super Admin** approves (which
executes it) or rejects it at `/platform/approvals`. A Super Admin performing the
same action runs it directly — the route calls `confidentialAction()` and the
branch is chosen by capability, so both paths run the *same* executor (no drift).

- Engine + executor registry: `src/server/approvals.ts` (`APPROVAL_ACTIONS`,
  `confidentialAction`, `approveRequest`, `rejectRequest`).
- Wired confidential actions: **restaurant suspend** and **restaurant archive**
  (`restaurants:write`). New actions plug in by adding a registry entry + calling
  `confidentialAction(req, '<action>', payload)` from the route.
- Capability `approvals:review` (Super Admin only) gates approve/reject.
- Requesters see their own requests + status; reviewers see the full queue.
- Tested in `__tests__/server/approvals.test.ts` (branch, execute, double-approve
  guard, reject) + approval cases in `permissions.test.ts`.

Every step is audited: `approval.request`, `approval.approve`, `approval.reject`.

## Roadmap

- Broaden capability guards to the remaining Super-Admin-only surfaces as they're
  delegated (each is a one-line `requireCapability(...)` swap).
- Register more confidential actions (payout publish, settlement export, IAM
  changes) in `APPROVAL_ACTIONS` so Admin Assist can request them too.
