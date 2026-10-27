# Integrated demo — Flavrly × Novaryq India (local only)

The ARCHITECTURE-INDIA §6 runbook. It runs on a laptop with no production access and fake data only.

```bash
scripts/integrated-demo/up.sh --record   # start the stack, then record the story into $DEMO_OUT
scripts/integrated-demo/run-demo.sh      # record the story again on a running stack
scripts/integrated-demo/down.sh          # stop everything, drop the data, remove the scratch worktrees
```

Re-record only the 86 / un-86 pass into the existing evidence folder:
`DEMO_ONLY=86 DEMO_APPEND=1 scripts/integrated-demo/run-demo.sh`.
Each story stage is soft: a stage that fails writes a `failed-<stage>` frame and a `STAGE FAILED` line in `story.log`, and the run carries on.
An optional `NOTES.md` in the evidence folder is placed at the top of the generated README.

Paths, branches and ports are set in `demo.conf`. By default:
- Novaryq is checked out at `origin/feat/flavrly-ordering-channel`. `origin/feat/india-flavrly-consumer-channel` is merged in when it exists.
- Flavrly is checked out at `origin/feat/novaryq-integration`.
- Evidence goes to `~/flavrly-pg-evidence/<date>/integrated-demo/`.

## What starts

| Piece | Where | Notes |
|---|---|---|
| Postgres 16 (private cluster) | `127.0.0.1:55440` | `ci_demo_nq` and `ci_demo_fl`. The Novaryq DB gets the release gate's role bootstrap, `migrate deploy`, `rls.sql` and `rls-roles.sql`. |
| Redis | `127.0.0.1:56391` | |
| Novaryq API | `127.0.0.1:4620` | `ts-node` with `MFA_POLICY=optional` (local demo) and `NOVARYQ_DEMO_ALLOW_LOOPBACK_WEBHOOKS=true` (see the patch below). |
| Novaryq web | `localhost:5173` and `flavrly-test-kitchen.novaryq.test:5173` | Vite dev server via `vite.demo.config.ts`. The demo browser maps `*.novaryq.test` to 127.0.0.1, so the POS runs on a real business host. |
| Flavrly web | `localhost:3100` | `next dev`. `.env.local` is generated with throwaway secrets, mock payments/SMS and `NOVARYQ_ALLOW_INSECURE_BASE_URL=true` (ignored in production). |
| Worker "cron" | — | Calls `POST /api/platform/jobs/novaryq-worker/run` every 5 s, standing in for `deploy/flavrly-jobs.cron`. |

## Seeds (all fake)

- **Novaryq**: the stock `prisma/seed.ts`, then `seed-novaryq.ts`, which creates:
  - IN tenant **Flavrly Test Kitchen** (INR, `Asia/Kolkata`);
  - sample GSTIN `29AAAAA0000A1Z5` (a format example, not a real registration) and GST 5 %;
  - HSN/SAC `996331` items with modifiers;
  - KDS stations;
  - PINs: cook 2468, manager 1357.
- **Flavrly**: the stock seed, then `seed-flavrly.ts`, which creates:
  - restaurant **Flavrly Test Kitchen** (auto-accept off);
  - a branch open all day;
  - test customer `+919990000101` and test rider `+919990000202`. Their OTP is shown on screen, never sent as an SMS.
- **Link**: `link-novaryq.mjs` does the owner's Novaryq console steps through the console API:
  - creates a partner API key;
  - creates the webhook subscription pointing at Flavrly.

  The Flavrly side is linked in the story through the real admin UI.

## Demo-only patch

`patches/novaryq-demo-loopback-webhooks.patch` is applied to the scratch Novaryq worktree only. It is never committed to Novaryq.

Novaryq's webhook egress guard refuses 127.0.0.1, which is correct in production. The patch allows exactly `127.0.0.1` when both of these hold:
- `NOVARYQ_DEMO_ALLOW_LOOPBACK_WEBHOOKS=true`;
- `NODE_ENV` is not `production`.

No production default changes.

## The story (`demo.spec.ts`, system Chrome, video for every actor)

1. The Flavrly admin signs in. On first sign-in this enrols Google Authenticator; the demo reads the manual key. The admin then connects Novaryq (URL, key, secret, webhook secret), links the branch to the Novaryq location (INR is checked) and imports the menu.
2. The Novaryq KDS opens.
3. A customer on a 390 px phone signs in with the on-screen test OTP. The storefront is also captured at 1440 px. The customer orders COD.
4. The "FLAVRLY ORD-…" ticket appears on the Novaryq KDS.
5. The kitchen bumps the ticket. Novaryq goes READY, and the Flavrly tracker shows READY.
6. The test rider goes online, claims the order, picks it up and delivers it with the customer's code, through the rider-app API. The web rider portal has no delivery screens. The rider portal is then captured.
7. A prepaid order (mock gateway) reaches the KDS.
8. On the POS (manager PIN), the manager 86s Mango Lassi. It disappears on Flavrly, then Restore brings it back.
9. The Novaryq receipt API is called for the channel order (GST invoice data).

`make-readme.mjs` writes `README.md` (a frame index with captions) and `story.mp4` (a slideshow of the frames) into the evidence folder.
