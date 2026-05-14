# Production Deployment — Hostinger KVM 2 + GoDaddy.in

**Target environment:** Hostinger KVM 2 VPS (Mumbai), GoDaddy.in domain, Cloudflare in front. Ubuntu 24.04 LTS. End-state: `https://yourdomain.in` is live, the rider APK installs and talks to it, and the demo is reproducible from a clean restore.

This is the **execution playbook**. It replaces the more generic `DEPLOY-INDIA.md` for the specific stack the user is on. Read it top-to-bottom once, then work the checklist in §13.

---

## TL;DR — order of operations

1. **Host the website first.** The rider APK is a Capacitor WebView shell pointing at `${FOODHUB_URL}/rider`. Build the APK before the site is live and you ship an app that can't load anything. The right sequence is: DNS → server → app live → APK built with the production URL baked in. (Full reasoning in §11.)
2. **Day-1 cost:** ~₹500–₹900/month for Hostinger KVM 2 + ~₹1,000/year for the GoDaddy domain + ₹0 for Cloudflare free tier.
3. **Plan-fit reality check:** KVM 2 is the smaller cousin of the originally-recommended KVM 4. It will demo cleanly and serve a single restaurant in production, but the headroom is tighter. §2 has the tuning that makes it work.

---

## 1. Plan-fit — KVM 2 vs the recommendation

The hosting recommendation in `HOSTING-DECISION.md` was **KVM 4** (4 vCPU / 16 GB RAM / 200 GB NVMe). You have **KVM 2** (2 vCPU / 8 GB RAM / 100 GB NVMe — Hostinger's typical KVM 2 spec). The implications:

| Resource | KVM 4 (recommended) | KVM 2 (yours) | What changes |
|---|---|---|---|
| vCPU | 4 | 2 | PM2 stays single-instance (`instances: 1`); no cluster mode |
| RAM | 16 GB | 8 GB | Postgres `shared_buffers` = **2 GB** (not 4), Node `max_memory_restart` stays at **700 M** |
| NVMe | 200 GB | 100 GB | Backups retained 14 days local, off-site to B2 from day 1 |
| Bandwidth | 16 TB | typically 8 TB | Fine for demo + early production; Cloudflare absorbs static asset traffic |

**This is workable for the demo and the first ~10–20 restaurants.** You should plan for an upgrade to KVM 4 before crossing ~500 concurrent customers or ~10 active restaurants live at the same time. The migration is a one-click rebuild on Hostinger — same IP, more horsepower, ~5 minutes of downtime.

---

## 2. Server provisioning — Hostinger KVM 2

### 2.1 Buy + boot

1. Hostinger control panel → **VPS** → KVM 2 → choose **Mumbai (in-mum-1)** datacenter
2. OS template: **Ubuntu 24.04 LTS** (do not pick a panel-based template like CyberPanel — we run our own stack)
3. Hostname: `maverick-prod-1`
4. SSH: upload your public key during provisioning (much cleaner than the root-password reset flow)
5. Provisioning takes ~3 minutes. You'll get a public IPv4 and IPv6 in the panel.

### 2.2 First-login hardening

```bash
ssh root@<your-vps-ip>

# Create the deploy user
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# Lock SSH
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# Patch + firewall
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades curl git build-essential \
              software-properties-common ca-certificates lsb-release \
              jq zip unzip htop
dpkg-reconfigure --priority=low unattended-upgrades

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Time + locale
timedatectl set-timezone Asia/Kolkata
locale-gen en_IN.UTF-8 || true

# Swap — KVM 2 with 8 GB RAM benefits from a 4 GB swap for Node build spikes
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-rm.conf
```

Now log out, log back in as `deploy`, and do everything below as that user.

---

## 3. DNS — GoDaddy.in → Cloudflare → Hostinger

GoDaddy's DNS is fine, but we want Cloudflare in front for free SSL termination, DDoS protection, and the wildcard certificate path. The setup is **transfer DNS authority to Cloudflare without transferring the domain**.

### 3.1 Add the domain to Cloudflare

1. `dash.cloudflare.com` → **Add Site** → enter `yourdomain.in` → choose **Free** plan
2. Cloudflare scans existing DNS records (from GoDaddy). Review them — there'll usually be a few parking records you can delete.
3. Cloudflare gives you **two nameservers** (e.g. `lia.ns.cloudflare.com`, `karl.ns.cloudflare.com`). **Copy these.**

### 3.2 Point GoDaddy at Cloudflare

1. GoDaddy.in dashboard → My Products → DNS for your domain → **Nameservers** → "Change"
2. Pick "Enter my own nameservers" → paste the two Cloudflare nameservers → save
3. Propagation takes 1–24 hours. Cloudflare emails you when it's active. Until then, the site below won't load via the domain — work via the bare IP for SSH.

### 3.3 Cloudflare DNS records

Once Cloudflare is active, add these records (under **DNS → Records**):

| Type | Name | Value | Proxy | Note |
|---|---|---|---|---|
| A | `@` | `<vps-ip>` | 🟧 Proxied | apex |
| A | `www` | `<vps-ip>` | 🟧 Proxied | www |
| A | `*` | `<vps-ip>` | 🟧 Proxied | wildcard — restaurant subdomains |
| A | `api` | `<vps-ip>` | 🟧 Proxied | optional later |
| AAAA | `@` | `<vps-ipv6>` | 🟧 Proxied | apex IPv6 |

The wildcard A record is what unlocks the per-restaurant subdomain pattern designed in `SUBDOMAIN-TENANCY.md` (`samosa-house.yourdomain.in`, etc.).

### 3.4 Cloudflare SSL settings

- **SSL/TLS → Overview** → set encryption mode to **Full** (not Flexible, not Full Strict yet)
- **SSL/TLS → Edge Certificates** → enable **Always Use HTTPS**, **Automatic HTTPS Rewrites**, **TLS 1.3**
- **SSL/TLS → Edge Certificates** → at the bottom, **Universal SSL** should be Active. The free Universal cert covers `yourdomain.in` and `*.yourdomain.in` once you add the wildcard record above. That gives us HTTPS at the edge for both the apex and every restaurant subdomain — no Let's Encrypt cert needed on the origin for Phase 1.

For Phase 2, you'd issue a **Cloudflare Origin Certificate** (Origin Server → 15-year cert) and install it on the VPS so nginx can serve HTTPS on :443 — then flip Cloudflare to **Full (Strict)**. Day-1 not required.

---

## 4. Install Node, Postgres, nginx

```bash
# Node 20 via nvm (matches engines field in package.json)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm alias default 20
node --version    # v20.x
corepack enable   # for any yarn/pnpm needs later
npm install -g pm2

# pm2 startup — copy and run the command it prints
pm2 startup systemd -u deploy --hp /home/deploy
```

### 4.1 Postgres 16

```bash
sudo apt install -y postgresql-16 postgresql-contrib

sudo -u postgres psql <<'SQL'
CREATE USER restaurant_manager WITH PASSWORD 'REPLACE_WITH_OPENSSL_RAND_32';
CREATE DATABASE restaurant_manager OWNER restaurant_manager;
\c restaurant_manager
GRANT ALL ON SCHEMA public TO restaurant_manager;
SQL
```

Edit `/etc/postgresql/16/main/postgresql.conf` for **8 GB RAM (KVM 2)**:

```ini
# Memory — adjusted for 8 GB total RAM with Node sharing the box
shared_buffers = 2GB
work_mem = 12MB
maintenance_work_mem = 256MB
effective_cache_size = 4GB
random_page_cost = 1.1

# Connections — keep below 100 so Node/Prisma pool plus pgbouncer (later) fit
max_connections = 60

# WAL — daily backups via dump, no PITR yet
wal_level = replica
max_wal_size = 1GB
min_wal_size = 80MB
checkpoint_completion_target = 0.9

# Logging — slow query monitoring
log_min_duration_statement = 500
log_line_prefix = '%t [%p] user=%u,db=%d,app=%a,client=%h '
```

Then `sudo systemctl restart postgresql`.

Quick smoke test: `psql -h 127.0.0.1 -U restaurant_manager -d restaurant_manager -c 'select 1'`.

### 4.2 nginx

```bash
sudo apt install -y nginx
sudo cp /opt/restaurant-manager/deploy/nginx.conf /etc/nginx/sites-available/restaurant-manager
sudo ln -sf /etc/nginx/sites-available/restaurant-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The shipped `deploy/nginx.conf` already handles:
- Cloudflare real-IP rewriting
- SSE no-buffering on `/api/events`
- `/uploads/` served from disk with `expires 30d`
- gzip, 10 MB body limit, /_next/static long cache

Wildcard subdomain support is in there via `server_name _;` — if you want to lock it down, change to `server_name yourdomain.in *.yourdomain.in;`.

---

## 5. Deploy the app

Copy or git-clone the code to `/opt/restaurant-manager`.

### 5.1 Initial deploy (one-time)

```bash
sudo mkdir -p /opt/restaurant-manager && sudo chown deploy:deploy /opt/restaurant-manager
cd /opt/restaurant-manager
git clone <your-repo-url> .

# Install deps with the production-only flag for the web app
cd apps/web
npm ci

# Generate the Prisma client
npx prisma generate
```

### 5.2 Write the production `.env`

Copy `deploy/.env.production.example` to `apps/web/.env` and fill in:

```bash
cp /opt/restaurant-manager/deploy/.env.production.example /opt/restaurant-manager/apps/web/.env
nano /opt/restaurant-manager/apps/web/.env
```

The example file has every variable commented inline. The minimum block to set before first boot:

- `DATABASE_URL` — from §4.1
- `NEXTAUTH_URL` — `https://yourdomain.in`
- `NEXTAUTH_SECRET` — `openssl rand -hex 32`
- `APP_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `RAZORPAY_*` — from your Razorpay dashboard (start in test mode)
- `MSG91_*` or `FAST2SMS_*` — pick one SMS provider
- `SMTP_*` — Zoho Mail (Lite is ₹90/user/month) or Brevo (free 300/day)

### 5.3 Migrate + seed

```bash
cd /opt/restaurant-manager/apps/web
npx prisma migrate deploy

# (Optional) seed the demo data — picks the demo brand
npm run db:seed:cuisines    # the 7-cuisine "Group of Cuisines" umbrella brand
```

If you're going to demo from this same box, **do seed**. The 7-cuisine seed creates 229 menu items, 21 combos, 14 offers, 56 sample orders, 21 riders with KYC — enough to show every flow.

### 5.4 Build

```bash
cd /opt/restaurant-manager/apps/web
npm run build
```

KVM 2 build memory tip: if the build OOMs (it shouldn't on 8 GB + 4 GB swap, but watch for it), prefix with `NODE_OPTIONS="--max-old-space-size=2048" npm run build`. The swap we created in §2.2 covers most cases.

### 5.5 Uploads directory

```bash
sudo mkdir -p /var/www/restaurant-manager/uploads
sudo chown -R deploy:deploy /var/www/restaurant-manager
```

The nginx site already serves `/uploads/` from this path.

### 5.6 PM2

```bash
cd /opt/restaurant-manager
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save
```

Verify:

```bash
pm2 ls                       # rm-web and rm-worker both "online"
pm2 logs rm-web --lines 50   # no startup errors
curl http://127.0.0.1:3000/api/system/health
# → {"ok":true,"db":"ok", ... }
```

Through nginx + Cloudflare:

```bash
curl -I https://yourdomain.in/api/system/health
# HTTP/2 200, served by cloudflare
```

---

## 6. Backups

```bash
sudo chmod +x /opt/restaurant-manager/deploy/backup.sh
sudo mkdir -p /var/backups/restaurant-manager /var/lib/restaurant-manager
sudo chown postgres:postgres /var/backups/restaurant-manager
sudo chown deploy:deploy /var/lib/restaurant-manager

# Daily at 02:15 IST. Override retention to 14 days local + 4 weeks of weeklies.
sudo tee /etc/default/rm-backup <<'EOF'
KEEP_DAILY=14
KEEP_WEEKLY=4
# RCLONE_REMOTE=b2:maverick-rm-backups   # uncomment after rclone config
EOF

sudo crontab -u postgres -e
# Add:
15 2 * * *  . /etc/default/rm-backup && /opt/restaurant-manager/deploy/backup.sh >> /var/log/rm-backup.log 2>&1
```

### Off-site (Backblaze B2 — ~$5/mo for 50 GB)

```bash
sudo apt install -y rclone
rclone config    # create remote "b2:" of type "Backblaze B2"
# Uncomment the RCLONE_REMOTE line in /etc/default/rm-backup once configured.
```

The shipped `deploy/backup.sh` reads `RCLONE_REMOTE` from `/etc/default/rm-backup` and uploads `*.dump.gz` after each local dump. With the override above: 14-day local retention, 14-day off-site (mirrored), plus 4 Sunday weeklies.

### Restore drill — do this once before you go live

```bash
# As deploy user
sudo -u postgres createdb restaurant_manager_restore_test
gunzip -c /var/backups/restaurant-manager/daily/rm-$(date -u +%F).dump.gz \
  | sudo -u postgres pg_restore -d restaurant_manager_restore_test --clean --no-owner
sudo -u postgres psql -d restaurant_manager_restore_test \
  -c "select count(*) from \"MenuItem\";"
# Expect ~229 if you seeded; non-zero in any case
sudo -u postgres dropdb restaurant_manager_restore_test
```

---

## 7. Monitoring

### 7.1 UptimeRobot (zero-cost, external)

1. Sign up at `uptimerobot.com` (free tier = 50 monitors, 5-min interval)
2. Create monitors:
   - **HTTPS** → `https://yourdomain.in/api/system/health` → keyword match `"ok":true`
   - **HTTPS** → `https://yourdomain.in/r/sample-restaurant-slug` → status 200
3. Add your email + a Telegram channel for alerts

### 7.2 Uptime Kuma (self-hosted, on-box)

Optional — only spin up if you need richer dashboards. It costs ~100 MB RAM.

```bash
sudo apt install -y docker.io
sudo docker run -d --restart=always -p 127.0.0.1:3001:3001 \
    -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1
```

Add an nginx subdomain `status.yourdomain.in` that proxies to `127.0.0.1:3001` if you want to expose it.

### 7.3 Server-side basics

```bash
# pm2 plus monitor — free tier is fine
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7

# Disk watch — alert when /var > 80%
echo 'WARN_DISK_PCT=80' | sudo tee /etc/default/rm-disk-watch
```

---

## 8. Razorpay live mode

Razorpay defaults to **Test mode** on signup. The flow to flip:

1. Razorpay dashboard → KYC → submit company details + bank account + PAN. ~24–48 h to approve.
2. Once approved, switch the dashboard toggle to **Live mode** and regenerate keys.
3. Update `.env`:
   ```
   RAZORPAY_KEY_ID="rzp_live_..."
   RAZORPAY_KEY_SECRET="..."
   RAZORPAY_WEBHOOK_SECRET="..."
   ```
4. Add a webhook in Razorpay → Webhooks → URL `https://yourdomain.in/api/payments/razorpay/webhook` → secret = whatever you put in `.env`. Events: `payment.captured`, `payment.failed`, `refund.processed`.
5. PM2 reload: `pm2 reload rm-web rm-worker --update-env`.
6. Test with a real ₹1 payment from your own card before the demo. Refund yourself.

---

## 9. SMS — MSG91 setup (recommended)

MSG91 is the most reliable Indian SMS gateway for OTP. Fast2SMS is fine for one-off transactional but has lower OTP deliverability.

1. Sign up at `msg91.com`, do DLT registration (required by TRAI — takes 2–3 business days)
2. Buy a Sender ID (typically `MVKFHB` or similar 6-char alpha — must match your brand)
3. Register your OTP template on the DLT portal — wait for it to be approved
4. Copy the **DLT Template ID** + your **MSG91 Auth Key** into `.env`:
   ```
   NOTIFIER_SMS="msg91"
   MSG91_AUTH_KEY="..."
   MSG91_SENDER_ID="MVKFHB"
   MSG91_ROUTE="4"
   MSG91_DLT_TEMPLATE_ID="1707..."
   ```
5. Top up with at least ₹500 — that's ~3,000 OTPs at ~₹0.15 each

Fallback: set `NOTIFIER_SMS="fast2sms"` and provide `FAST2SMS_API_KEY` if you want a same-day option while waiting for DLT.

---

## 10. Email — Zoho Mail (recommended)

1. Sign up at `zoho.com/mail` → add your domain → verify via the TXT record they tell you to put in Cloudflare DNS
2. Add MX records in Cloudflare:
   | Type | Name | Mail server | Priority | Proxy |
   |---|---|---|---|---|
   | MX | `@` | `mx.zoho.in` | 10 | DNS only ⚪ |
   | MX | `@` | `mx2.zoho.in` | 20 | DNS only ⚪ |
   | MX | `@` | `mx3.zoho.in` | 50 | DNS only ⚪ |
3. Add the SPF + DKIM TXT records Zoho generates
4. Create `orders@yourdomain.in` → generate an **app-specific password** (don't use your account password)
5. `.env`:
   ```
   NOTIFIER_EMAIL="zoho_smtp"
   SMTP_HOST="smtp.zoho.in"
   SMTP_PORT="587"
   SMTP_USER="orders@yourdomain.in"
   SMTP_PASS="<app-password>"
   SMTP_FROM="orders@yourdomain.in"
   SMTP_SECURE="false"
   ```

Brevo (formerly Sendinblue) is a fine alternative — free 300 emails/day, sends via SMTP, just swap `SMTP_HOST=smtp-relay.brevo.com` and use the API key as the password.

---

## 11. APK build — **after** the website is live

### Why "after"

The rider app is a Capacitor WebView wrapping `${FOODHUB_URL}/rider`. Look at `apps/android-rider/capacitor.config.ts`:

```ts
const FOODHUB_URL = process.env.FOODHUB_URL ?? 'http://10.0.2.2:3000';
const config: CapacitorConfig = {
  appId: 'app.foodhub.rider',
  appName: 'FoodHub Rider',
  webDir: 'public',
  server: { url: `${FOODHUB_URL}/rider`, cleartext: true, androidScheme: 'https' },
  // ...
};
```

The `server.url` is baked into the APK at build time. If you build before the production URL is reachable, you'll either:
- Build with the dev fallback (`http://10.0.2.2:3000`) and ship an app that only works in the Android emulator, or
- Build with a domain that doesn't resolve and ship an app that shows `ERR_NAME_NOT_RESOLVED` on every device

**The correct order is:**
1. Deploy web app (§§2–7)
2. Confirm `https://yourdomain.in/rider/login` loads in a desktop browser
3. *Then* build the APK with `FOODHUB_URL=https://yourdomain.in`
4. Sideload or distribute

### 11.1 Local prereqs (on your dev machine, not the VPS)

- **macOS / Linux / Windows** — Android Studio Arctic Fox+ installed
- **Java 17** (`brew install temurin@17` on macOS)
- **Node 20** (already required by the web app)
- The repo cloned locally

### 11.2 First-time wrapper setup

```bash
cd "/Users/hkulkarni/Documents/Claude/Projects/Restaurant Manager/apps/android-rider"
npm install
echo "FOODHUB_URL=https://yourdomain.in" > .env

# One-time — generates apps/android-rider/android/ from capacitor.config.ts
FOODHUB_URL=https://yourdomain.in npx cap add android
FOODHUB_URL=https://yourdomain.in npx cap sync android
```

After `cap add android` runs, the `android/` project is the source of truth and `capacitor.config.ts` is re-read on each `cap sync`.

### 11.3 Generate a signing key (one-time, keep this safe)

```bash
cd apps/android-rider/android/app
keytool -genkeypair -v \
  -keystore foodhub-rider-release.keystore \
  -alias foodhub \
  -keyalg RSA -keysize 2048 \
  -validity 36500
# Set a strong password — write it down somewhere safe (1Password, etc.)
```

Then add to `apps/android-rider/android/keystore.properties` (do not commit):

```
storePassword=<your-keystore-password>
keyPassword=<your-keystore-password>
keyAlias=foodhub
storeFile=foodhub-rider-release.keystore
```

And wire it into `apps/android-rider/android/app/build.gradle` `android { ... }` block:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 11.4 Build the release APK

```bash
cd apps/android-rider
FOODHUB_URL=https://yourdomain.in npx cap sync android
cd android
./gradlew assembleRelease
# Outputs:
# apps/android-rider/android/app/build/outputs/apk/release/app-release.apk
```

Or use the shipped one-shot script:

```bash
deploy/build-apk.sh https://yourdomain.in
# Drops the signed APK to ./out/foodhub-rider-<date>-<git-sha>.apk
```

### 11.5 Sideload

1. Phone → **Settings → Security → Install unknown apps** → enable for your file manager
2. Transfer `app-release.apk` via USB, Google Drive, or `adb install app-release.apk`
3. Tap to install. First launch: grant Location (always) + Camera + Notifications

Login with one of the seeded rider phones (see `prisma/seed-brand-mavericks.ts` — `+91 80009 00001` through `+91 80009 00021`) + the OTP from MSG91.

### 11.6 Play Store path (later)

When you're ready to publish:
- Google Play Console (one-time ₹2,000 setup fee, lifetime)
- In Android Studio: **Build → Generate Signed Bundle** → AAB (not APK)
- Upload AAB → Internal Testing → Closed Testing → Production
- First production review: 1–7 days

---

## 12. Subdomain tenancy (when you're ready)

The architecture for per-restaurant subdomains (`samosa-house.yourdomain.in` → tenant context) is fully designed in `SUBDOMAIN-TENANCY.md`. The DNS wildcard A record from §3.3 + the Cloudflare wildcard cert from §3.4 are already in place. To activate:

1. Implement the middleware described in `SUBDOMAIN-TENANCY.md` (Restaurant.slug → request context)
2. Set `COOKIE_DOMAIN=.yourdomain.in` in `.env` so auth cookies span subdomains
3. Reload: `pm2 reload rm-web --update-env`
4. Test: `curl https://samosa-house.yourdomain.in` → routes to the right tenant

Optional for the demo. Required before onboarding multiple paying restaurants.

---

## 13. Pre-demo checklist

Run through this 24 hours before the demo. Time-box each item to 5 minutes.

### DNS + edge
- [ ] `dig yourdomain.in` shows Cloudflare nameservers
- [ ] `dig samosa-house.yourdomain.in` resolves to Cloudflare proxy IP
- [ ] `https://yourdomain.in` loads with a valid SSL certificate (lock icon, no warnings)
- [ ] `curl -I https://yourdomain.in` shows `server: cloudflare` and HTTP/2 200

### Origin
- [ ] `pm2 ls` shows `rm-web` and `rm-worker` both `online` for >12 hours
- [ ] `https://yourdomain.in/api/system/health` returns `{"ok":true,"db":"ok"}` (proxied through CF)
- [ ] `http://127.0.0.1:3000/api/system/health` returns the same on the box (direct origin)
- [ ] Disk usage `df -h /` < 60%
- [ ] RAM usage `free -h` shows >2 GB free
- [ ] Postgres: `sudo -u postgres psql -c "SELECT count(*) FROM \"MenuItem\";"` shows the seeded count

### Integrations
- [ ] Razorpay test payment of ₹1 from your own card succeeds; refund visible in dashboard
- [ ] SMS OTP delivered to your phone in <10 seconds
- [ ] Email OTP / order confirmation lands in inbox (not spam) — check SPF + DKIM via `mail-tester.com`
- [ ] Razorpay webhook signature verified (look for `payment.captured` log line)

### Customer flow
- [ ] Open `https://yourdomain.in/r/<demo-slug>` → menu loads with images
- [ ] Add 3 items → cart sticky bar appears on mobile → /cart → /checkout
- [ ] Place order → Razorpay test → success → confirmation page
- [ ] SMS + email confirmation received within 30 s

### Restaurant + kitchen flow
- [ ] Log in as `owner@<demoslug>.test` → see new order on `/admin/orders`
- [ ] Log in as kitchen at `/kitchen` → order moves through preparing → ready
- [ ] KOT prints to terminal log (or thermal printer if attached)

### Rider flow
- [ ] APK installs without "unsafe app" warning bypassed
- [ ] Log in as `+91 80009 00001` → see assigned order
- [ ] Accept → live GPS tracking appears on customer `/track/<orderId>` page
- [ ] Mark delivered + capture proof photo → upload succeeds

### Backups + monitoring
- [ ] `/var/backups/restaurant-manager/daily/rm-<today>.dump.gz` exists from last night's run
- [ ] Off-site B2 backup uploaded (`rclone ls b2:maverick-rm-backups | head`)
- [ ] UptimeRobot shows green for >24 hours on all monitors
- [ ] Deliberately stop `rm-web` → UptimeRobot alerts within 5 minutes → restart → recovers

### Stretch (nice to have for the demo)
- [ ] Super-admin: `/platform/system-health` everything green
- [ ] Super-admin: create a second test restaurant via the wizard at `/platform/restaurants/new`
- [ ] Run `npm test` on the local dev machine — all 341/341 green (so you can speak to coverage if asked)

When every box in §13 is checked, you're production-ready and demo-safe.

---

## 14. Common day-1 gotchas

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` from Cloudflare | nginx up, Node down | `pm2 restart rm-web` and check `pm2 logs rm-web` |
| `522 Connection Timed Out` | UFW blocking 80/443 | `sudo ufw status` — re-allow if missing |
| `526 Invalid SSL Certificate` | Cloudflare on Full (Strict) but origin has no TLS | Switch back to **Full** (not Strict) until you install the Origin cert |
| `Too many open files` in pm2 logs | systemd nofile limit | Add `LimitNOFILE=65535` to the systemd service file pm2 generated |
| Prisma `P1001 Can't reach DB` | Postgres on wrong port or password mismatch | `psql -h 127.0.0.1 -U restaurant_manager -d restaurant_manager` — fix till that works, then update DATABASE_URL |
| Razorpay webhook 401 | Mismatched `RAZORPAY_WEBHOOK_SECRET` | Regenerate in Razorpay → paste into `.env` → `pm2 reload rm-web --update-env` |
| APK shows `ERR_NAME_NOT_RESOLVED` on first launch | DNS not yet propagated or you built against a placeholder URL | Confirm `https://yourdomain.in/rider` loads in a browser; rebuild APK with the right `FOODHUB_URL` |
| APK can't reach origin on cellular | Cloudflare rate-limiting or country block | CF dashboard → Security → Events → check for blocks; whitelist mobile carrier ranges if needed |
| MSG91 OTPs not delivered | DLT template still pending approval | Use Fast2SMS as fallback until DLT approval comes through (1–3 business days) |

---

## 15. Artifact index

Everything you need is committed:

| File | What it is |
|---|---|
| `docs/PRODUCTION-DEPLOY.md` | This guide |
| `docs/DEPLOY-INDIA.md` | The more generic India deployment guide (still useful as reference) |
| `docs/HOSTING-DECISION.md` | Why Hostinger over the alternatives |
| `docs/SUBDOMAIN-TENANCY.md` | Wildcard subdomain design (Phase 1.5 work) |
| `docs/ARCHITECTURE-V2.md` | 4-phase scaling roadmap |
| `deploy/nginx.conf` | Drop-in nginx site config |
| `deploy/ecosystem.config.cjs` | PM2 process definitions |
| `deploy/backup.sh` | Daily Postgres dump + rclone upload |
| `deploy/.env.production.example` | Every env var, commented |
| `deploy/deploy.sh` | Server-side update script (`git pull && build && pm2 reload`) |
| `deploy/build-apk.sh` | One-shot signed APK build with `FOODHUB_URL` baked in |
