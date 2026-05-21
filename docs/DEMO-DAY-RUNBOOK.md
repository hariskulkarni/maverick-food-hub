# Maverick Food Hub — Demo-Day Runbook

_Production: **http://148.230.66.124** (served over HTTP — see "Known constraints"). Single VPS, pm2 process `rm-web`._

---

## 0. Pre-demo checklist (run ~30 min before)

- [ ] **Site loads:** open `http://148.230.66.124/` in a fresh/incognito window → landing page renders with CSS + images.
- [ ] **Deploy is current:** local repo has nothing un-deployed: `git status` is clean and `git log --oneline -1` matches what's live. If unsure, run the deploy (Section 4).
- [ ] **Demo OTP is on:** phone logins show the code on screen (no SMS gateway yet). This is expected in demo mode.
- [ ] **Health is green:** super-admin → **Platform → Observability** → "Run checks now" → DB / System / App = UP.
- [ ] **Have logins ready** (Section 2) in separate browser profiles/incognito windows so you can switch roles instantly.

---

## 1. The 5-minute happy-path story

1. **Customer orders** — open a restaurant (e.g. `/r/saffron-smoke`), add items, go to **Checkout**. Show **Delivery / Pickup** options, the price breakdown incl. **Restaurant Packaging ₹20**, apply a coupon, place the order (COD or mock online).
2. **Kitchen accepts** — switch to the Kitchen view; the new order appears in real time; accept → preparing → ready.
3. **Rider delivers** — (rider app / rider flow) claim → pickup → deliver; customer's tracker updates live.
4. **Admin controls** — Admin → **Settings** → show editable **Packaging fee**, order-flow toggles (pickup / scheduled / dine-in), menu, offers.
5. **Super-admin oversight** — Platform → All orders, Live tracking, and the new **Observability** dashboard (health of everything).

> Tip: have one item already in a cart and the kitchen tab already open so step 1→2 is instant.

---

## 2. Logins

| Role | How to log in |
|---|---|
| **Customer** | `/login` → enter phone → **the OTP appears on the screen** (demo mode) → enter it. (Seed customer: Priya, `+919876500001`.) |
| **Restaurant admin** | `/login` (admin mode) → email + password (seed owner: "Aarav (Owner)"). |
| **Super admin** | `/login?mode=admin` → super-admin email + password → lands on `/platform`. |
| **Rider** | Rider app → phone → OTP (shown on screen in demo mode). |

_OTP codes are shown on the login screen because `OTP_DEMO_MODE=true` + `NOTIFIER_SMS=mock`. No phone/SMS needed for the demo._

---

## 3. Feature talking points (all live)

- **Ordering:** delivery + pickup, scheduled orders, coupons, offers, happy-hours, freebies, packaging fee, multi-restaurant groups.
- **Real-time:** kitchen board + customer tracker + live rider map update over SSE (now **authorization-gated** per channel).
- **Security hardening:** SSE channel authz, OTP demo/real plug-and-play guard, encryption-key enforcement, CSP + security headers, rate limiting on public endpoints, signature-verified payment webhooks. (See `docs/security/api-route-security-matrix.md`.)
- **Observability (new):** Platform → Observability — live health of DB, server (CPU/mem/disk), SSL/domain, integrations, realtime; plus a searchable **error explorer** with what/where attribution and per-area status. Hit **"Run checks now"** for a live refresh.

---

## 4. If something breaks mid-prep — recovery

**Always-safe full redeploy** (rebuilds + restarts; fails safe if the build errors):
```
cd ~/Documents/Claude/Projects/"Restaurant Manager"
git push origin main
ssh deploy@148.230.66.124 'bash -s' < scripts/fix-prod.sh
```
- Watch for `✓ Compiled successfully` (step 8) and `status: online` (step 9).
- If the build fails, the script **stops before restarting** (no crash-loop) and prints the error.

**Symptom → fix:**
- **CSS/images broken / unstyled page** → almost always browser cache: hard-refresh **Cmd+Shift+R**. (CSP `upgrade-insecure-requests` is disabled on HTTP, so assets load fine.)
- **"Application error" / pages 500** → run the redeploy above; clears any stale `.next`.
- **Login code not showing** → confirm `OTP_DEMO_MODE=true` in the VPS `apps/web/.env`.
- **Check what's wrong fast** → Platform → Observability → Run checks now → read the status cards + error explorer.
- **Raw server log:** `ssh deploy@148.230.66.124 "pm2 logs rm-web --err --lines 40 --nostream"`.

---

## 5. Known constraints (so nothing surprises you on stage)

- **HTTP, not HTTPS** — the site is on a bare IP with no TLS. Browser shows "Not secure"; that's expected. (HTTPS-only headers auto-enable once a domain + TLS are added — set `NEXTAUTH_URL=https://...`.)
- **Demo SMS** — OTPs are shown on screen, not texted. Plug-and-play to real SMS later: set `NOTIFIER_SMS=<provider>` + key and `OTP_DEMO_MODE=false`, then redeploy.
- **Guest order tracking** — anonymous `/track` won't get *live* SSE updates (order channels require the owning customer/rider/admin); the page still shows order status from the server.
- **Observability error capture** — captures errors logged by the app; auto-capturing every RSC render error is a planned follow-up.

---

## 6. Post-demo nice-to-haves (not blocking)

- Add a domain + HTTPS (Caddy/Let's Encrypt) → flips on HSTS/secure cookies/`upgrade-insecure-requests` automatically.
- Wire a real SMS provider (2Factor recommended for India).
- Observability v2: active per-page uptime pings + response-time charts + alerting.
