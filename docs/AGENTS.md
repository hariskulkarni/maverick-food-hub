# How the agency-agents personas were used

You asked for the build to feel "orchestral" using the 184 agents in `~/.claude/agents/`.
Those personas activate inside Claude Code CLI sessions — they aren't callable as parallel
processes from this Cowork session. Instead I treated them as a structured division-of-labor
scaffold and explicitly took on each relevant role in turn while building this app:

| Persona | Where its work shows up |
|---|---|
| **Backend Architect** | `docs/ARCHITECTURE.md`, the schema in `apps/web/prisma/schema.prisma`, server module boundaries in `apps/web/src/server/*` |
| **Frontend Developer** | All four surfaces under `apps/web/src/app/{(customer),admin,kitchen,rider}/`, custom shadcn-derived components in `src/components/ui/*` |
| **Database Architect** | Prisma schema, indices on hot paths, multi-branch from day one, JSON columns kept narrow |
| **Payments Engineer** | `src/server/payments/` adapter pattern with Razorpay + mock implementations, HMAC verification, webhook |
| **DevOps Engineer** | `Dockerfile` (multi-stage), `docker-compose.yml`, `.env.example`, `next.config.mjs` security headers, health/ready endpoints |
| **Senior QA** | Vitest unit tests (`tests/unit/*`), Playwright e2e (`tests/e2e/*`), test config |
| **UX / Designer** | Design tokens in `src/styles/globals.css`, Inter + Fraunces typography, mobile-first layouts, ASCII-clean status timeline |
| **Threat Detection / Security** | Argon2id passwords, single-use OTPs with attempt limiting, RBAC middleware, Razorpay HMAC verification, security headers |
| **Reality Checker** | The state machine in `src/server/orders.ts` enforces only legal transitions; pricing engine has unit tests covering boundary cases (negative totals, coupon thresholds) |
| **Technical Writer** | `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `docs/API.md`, `docs/ROADMAP.md`, this file |

If you'd like to *invoke* the agency-agents personas directly on this codebase, open a Claude Code
session in the project root and say things like:

```
Activate Threat Detection Engineer and audit this auth flow.
Activate Reality Checker and verify the order state machine handles every PDF scenario.
Activate Technical Writer and turn docs/ARCHITECTURE.md into a customer-facing pitch deck.
```
