# YouPI-PG self-host on the Flavrly VPS (pilot runbook)

Status: **not live.** This documents how to stand YouPI-PG up on the **same VPS**
as Flavrly and wire it to the pilot. Payment code only goes live after an
explicit go + a working instance + one real test payment.

Upstream: https://github.com/youpi-pg/YouPI-PG

## What YouPI-PG actually is
A **self-hosted UPI payment *verification* gateway**. It does **not** custody,
route, or settle funds — money lands directly in your configured UPI/bank
account. It confirms a payment by generating a unique paise amount and matching
the incoming **bank-credit SMS and/or Gmail** to it. Not a bank/acquirer API,
no settlement guarantee. Know this before taking real money through it.

## Services & ports (runs as a Node cluster via `npm start`)
| Service | Port | Exposure on our VPS |
|---|---|---|
| Payment Core REST API | 6100 | **localhost only** — Flavrly calls `http://127.0.0.1:6100` |
| Checkout Portal | 7000 | **public** via nginx `pay.flavrly.in` + TLS (customer pay page) |
| Merchant Admin | 6001 | localhost / SSH-tunnel only (get merchantId + webhook secret here) |
| Control Center | 8090 | localhost only |
| Help Portal | 3000 | ⚠ collides with Flavrly `rm-web` (127.0.0.1:3000) — remap via `HELP_PORTAL_PORT` |
| Gmail Observer | 6003 | localhost only |
| SMS Observer | 6002 | localhost only |

Node **22.13+/24** required. SQLite default (no second Postgres needed for the
pilot — keeps the box light). Docker optional; we run it under pm2.

## The one piece that isn't pure server
Verification needs a **bank-credit feed** for the **receiving account**:
- an **Android phone** paired + always online running YouPI's app + Google
  Messages automation, receiving the bank's credit SMS, **or**
- a **Gmail** inbox receiving those bank credit emails (OAuth via Gmail Observer).

This cannot live purely on the VPS — it needs a real device/inbox tied to the
receiving UPI account.

## Install (deploy console / SSH as `deploy`)
```bash
# Node 24 (if not present) + git already installed on the box
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
cd /opt && sudo git clone https://github.com/youpi-pg/YouPI-PG.git youpi-pg
sudo chown -R deploy:deploy /opt/youpi-pg && cd /opt/youpi-pg
npm install
cp .env.example .env
# edit .env: NODE_ENV=production, ENCRYPTION_MASTER_KEY (64 hex), JWT_SECRET (32+),
#   HELP_PORTAL_PORT=3100 (avoid rm-web's 3000), INITIAL_ADMIN_*; keep the rest localhost
nano .env
# run under pm2 alongside rm-web
pm2 start "npm start" --name youpi-pg --cwd /opt/youpi-pg && pm2 save
```

## nginx — expose only the Checkout Portal
Add a vhost `pay.flavrly.in` → `proxy_pass http://127.0.0.1:7000;` with a cert
(`certbot --nginx -d pay.flavrly.in`). DNS A record for `pay.flavrly.in` → VPS IP.
Do **not** expose 6100/6001/8090/6002/6003.

## Wire Flavrly to it
1. Merchant Admin (`http://127.0.0.1:6001`, via SSH tunnel) → create merchant →
   note **Merchant ID** (X-Merchant-Id, UUID) + **webhook/merchant secret**.
2. Register the merchant webhook URL in YouPI:
   `https://portal.flavrly.in/api/payments/youpi/webhook`
   (if the webhook target were a LAN address you'd set `YOUPI_ALLOW_PRIVATE_WEBHOOKS=true` — not needed here, it's a public URL).
3. In Flavrly **super-admin → `/platform/youpi`**, enter:
   - **Gateway base URL** = `http://127.0.0.1:6100`
   - **Merchant ID** = the X-Merchant-Id UUID
   - **Merchant key / webhook secret** = the merchant secret
   - optional caps: daily limit, max amount (paise)
4. Per restaurant: approve its YouPI feature request + set its **Receiving VPA**.

## Flavrly ↔ YouPI contract (implemented in `youpi-api.ts`)
- Create: `POST /api/v1/payments`, headers `X-Merchant-Id` + `Idempotency-Key`,
  body `{orderId, amount:"<INR>.dd", currency:"INR", customer, returnUrl}` → `{paymentId, checkoutUrl}`.
- Status: `GET /api/v1/payments/{id}`, header `X-Merchant-Key` → `{status, amountPaise}`.
  Map: SUCCESS→CAPTURED; FAILED/CANCELLED/EXPIRED→FAILED; INITIATED/ACTIVE/QUEUED/PROCESSING→PENDING.
- Webhook: `X-Gateway-Signature: sha256=HMAC-SHA256(secret, rawBody)`, payload
  `{event, orderId, amount, amountPaise, utr, paymentId}`. Flavrly **ignores the body**
  and re-verifies via the status API (single-winner capture). Already correct.

## Resource note
Confirm the VPS headroom before adding the stack (`free -h`, `nproc`, `df -h`).
rm-web runs ~400 MB; YouPI's cluster + SQLite adds more. If RAM is tight, a
separate small VPS for payments is the safer call.

## Go-live gate
Deploy PR #11 (merge → auto-deploy) only after: instance up, phone/Gmail paired
to the receiving account, config entered, and **one real small payment** verified
end-to-end (create → pay → webhook → order flips PAID). Never before.
