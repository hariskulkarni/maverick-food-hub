# Single-VPS deployment — India edition

This guide walks through the **Phase 1, low-cost** production setup for
Restaurant Manager on a single Indian VPS. Target spec: **4 vCPU / 8 GB RAM /
100 GB SSD**, Ubuntu **24.04 LTS**. Hosts that work well: Hetzner, Linode (now
Akamai), DigitalOcean Bangalore, OVH India, BigRock VPS.

> Operational goal: **₹2–4k/month** of fixed infra, including DNS + SSL via
> Cloudflare (free tier), MSG91 SMS prepaid, and Zoho Mail (Lite ₹90/user/mo).

---

## 0. Prerequisites

You'll need:

| Thing | Where |
|---|---|
| A domain | Registered anywhere, DNS delegated to Cloudflare |
| A Cloudflare account | `dash.cloudflare.com` — free plan is fine |
| A VPS (Ubuntu 24.04) | Any India region |
| MSG91 / Fast2SMS account | For OTPs and SMS (see §7) |
| Zoho Mail or Brevo | For transactional email (see §7) |
| Razorpay account | For payments |
| (Optional) Uptime Kuma | We host this on the same VPS at :3001 |

---

## 1. Initial server setup

```bash
# As root, immediately after provisioning
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades curl git build-essential
dpkg-reconfigure --priority=low unattended-upgrades

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Lock down SSH — disable password auth
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
```

Then log in as `deploy` for everything below.

---

## 2. Install Node 20 (LTS) via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm alias default 20
node --version    # v20.x
npm install -g pm2
pm2 startup systemd -u deploy --hp /home/deploy   # follow the printed instructions
```

---

## 3. Install Postgres 16

```bash
sudo apt install -y postgresql-16 postgresql-contrib
sudo -u postgres psql <<SQL
CREATE USER restaurant_manager WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE restaurant_manager OWNER restaurant_manager;
\c restaurant_manager
GRANT ALL ON SCHEMA public TO restaurant_manager;
SQL
```

Tune `/etc/postgresql/16/main/postgresql.conf` for 8 GB RAM:

```
shared_buffers = 2GB
work_mem = 16MB
maintenance_work_mem = 256MB
effective_cache_size = 5GB
random_page_cost = 1.1
```

Restart: `sudo systemctl restart postgresql`.

---

## 4. Clone and build the app

```bash
sudo mkdir -p /opt/restaurant-manager && sudo chown deploy:deploy /opt/restaurant-manager
cd /opt/restaurant-manager
git clone <your-repo-url> .
cd apps/web
npm ci
npx prisma migrate deploy
npm run build
```

Create `/opt/restaurant-manager/apps/web/.env` — see §7 for variable list.

Make the uploads directory:

```bash
sudo mkdir -p /var/www/restaurant-manager/uploads
sudo chown -R deploy:deploy /var/www/restaurant-manager
```

---

## 5. nginx site

```bash
sudo apt install -y nginx
sudo cp /opt/restaurant-manager/deploy/nginx.conf /etc/nginx/sites-available/restaurant-manager
sudo ln -sf /etc/nginx/sites-available/restaurant-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

SSL is terminated **at Cloudflare** (Full SSL mode). In Cloudflare:

1. DNS → A record `@` → your VPS IP (orange-cloud / proxied).
2. SSL/TLS → set to **Full**.
3. SSL/TLS → Origin Server → create a 15-year origin certificate, install it
   on the VPS at `/etc/ssl/certs/cloudflare-origin.pem` if you want origin
   HTTPS later. For Phase 1, plain HTTP origin behind orange-cloud is fine.

---

## 6. PM2

```bash
cd /opt/restaurant-manager
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

Check: `pm2 ls` should show `rm-web` and `rm-worker` both `online`.

Logs: `pm2 logs rm-web --lines 200`.

---

## 7. Environment variables

Minimum `.env` for Phase 1:

```ini
# Core
DATABASE_URL="postgresql://restaurant_manager:CHANGE_ME_STRONG@127.0.0.1:5432/restaurant_manager"
NEXTAUTH_URL="https://yourdomain.in"
NEXTAUTH_SECRET="$(openssl rand -hex 32)"
APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # used by src/server/crypto.ts
DEPLOYMENT_MODE="LOW_COST_SINGLE_VPS"
STORAGE_PROVIDER="local"
LAST_BACKUP_MARKER="/var/lib/restaurant-manager/last-backup.txt"

# SMS — pick ONE provider, set NOTIFIER_SMS / SMS_PROVIDER accordingly
NOTIFIER_SMS="msg91"
MSG91_AUTH_KEY="..."
MSG91_SENDER_ID="YOURBR"
MSG91_ROUTE="4"
MSG91_DLT_TEMPLATE_ID="1707xxxxxxxxxxxxxx"
# or:
# NOTIFIER_SMS="fast2sms"
# FAST2SMS_API_KEY="..."
# or:
# NOTIFIER_SMS="textlocal"
# TEXTLOCAL_API_KEY="..."
# TEXTLOCAL_SENDER_ID="YOURBR"

# Email — pick ONE
NOTIFIER_EMAIL="zoho_smtp"
SMTP_HOST="smtp.zoho.in"
SMTP_PORT="587"
SMTP_USER="orders@yourdomain.in"
SMTP_PASS="zoho-app-password"
SMTP_FROM="orders@yourdomain.in"
SMTP_SECURE="false"
# or:
# NOTIFIER_EMAIL="brevo_smtp"
# SMTP_HOST="smtp-relay.brevo.com"
# ...

# Razorpay
RAZORPAY_KEY_ID="rzp_live_..."
RAZORPAY_KEY_SECRET="..."
RAZORPAY_WEBHOOK_SECRET="..."

# Feature flags (Phase 1 — keep most off)
ENABLE_WALLET="false"
ENABLE_LOYALTY="false"
ENABLE_WHATSAPP="false"
ENABLE_S3_STORAGE="false"
```

Per-restaurant overrides live in the `IntegrationCredential` table — managed
from the restaurant settings UI. The env values are the fallback only.

After editing `.env`, reload PM2: `pm2 reload rm-web rm-worker --update-env`.

---

## 8. Backups (cron)

```bash
sudo chmod +x /opt/restaurant-manager/deploy/backup.sh
sudo mkdir -p /var/backups/restaurant-manager /var/lib/restaurant-manager
sudo chown postgres:postgres /var/backups/restaurant-manager
sudo chown deploy:deploy /var/lib/restaurant-manager

# Daily at 02:15
sudo crontab -u postgres -e
# Add:
15 2 * * *  /opt/restaurant-manager/deploy/backup.sh >> /var/log/rm-backup.log 2>&1
```

Off-host: install `rclone`, configure a Backblaze B2 / S3 remote, set
`RCLONE_REMOTE=b2:rm-backups` in the cron environment. The script handles
upload + remote retention.

Restore drill (do this once before going live):

```bash
gunzip -c /var/backups/restaurant-manager/daily/rm-YYYY-MM-DD.dump.gz \
  | pg_restore -h 127.0.0.1 -U restaurant_manager -d restaurant_manager_restore_test --clean --no-owner
```

---

## 9. Monitoring (Uptime Kuma)

```bash
sudo apt install -y docker.io
sudo docker run -d --restart=always -p 127.0.0.1:3001:3001 \
    -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1
```

Add an nginx subdomain `status.yourdomain.in` that proxies to `127.0.0.1:3001`,
then configure two monitors:

| Monitor | URL | Interval | Alert |
|---|---|---|---|
| App health | `https://yourdomain.in/api/system/health` | 60 s | JSON `db == "ok"` |
| TCP — Postgres | `127.0.0.1:5432` | 5 min | local |

Plug a Telegram / Slack notification channel for alerts.

---

## 10. Going live

- [ ] DNS A record points to VPS (Cloudflare orange-cloud)
- [ ] `https://yourdomain.in` loads and shows the login page
- [ ] `/api/system/health` returns `{ ok: true, db: 'ok' }`
- [ ] Razorpay integration tested from the platform UI
- [ ] At least one SMS provider tested from the platform UI
- [ ] At least one SMTP provider tested
- [ ] `backup.sh` ran once manually and produced a dump
- [ ] Uptime Kuma is alerting on a deliberately-failed test
- [ ] `pm2 save` has been run so processes restart on reboot
- [ ] Super-admin can reach `/platform/system-health` and everything is green

You're done. Welcome to production.
