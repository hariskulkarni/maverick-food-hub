# Deploy artifacts

Drop-in files used by the production runbook in `../docs/PRODUCTION-DEPLOY.md`.

| File | Where it goes | Purpose |
|---|---|---|
| `nginx.conf` | `/etc/nginx/sites-available/restaurant-manager` (symlinked into `sites-enabled`) | Reverse proxy + SSE no-buffering + uploads serving + Cloudflare real-IP |
| `ecosystem.config.cjs` | Stays at `/opt/restaurant-manager/deploy/` | PM2 process definitions: `rm-web` (Next.js) + `rm-worker` (cron + escalations) |
| `backup.sh` | Stays at `/opt/restaurant-manager/deploy/` | Daily `pg_dump` rotation + optional rclone push to Backblaze B2 |
| `deploy.sh` | Stays at `/opt/restaurant-manager/deploy/` | `git pull` + `npm ci` + `prisma migrate deploy` + `npm run build` + `pm2 reload`, with rollback |
| `build-apk.sh` | Runs on the **developer machine**, not the VPS | Signed APK build with `FOODHUB_URL` baked in |
| `.env.production.example` | Copy → `/opt/restaurant-manager/apps/web/.env` | Every env var commented |

## Cheat sheet

```bash
# Initial bootstrap (VPS, as deploy)
cp deploy/.env.production.example apps/web/.env
nano apps/web/.env
cd apps/web && npm ci && npx prisma migrate deploy && npm run build
pm2 start /opt/restaurant-manager/deploy/ecosystem.config.cjs --env production
pm2 save

# Ship a new release (VPS, as deploy)
cd /opt/restaurant-manager && ./deploy/deploy.sh

# Roll back (VPS, as deploy)
./deploy/deploy.sh rollback

# Build the rider APK (dev machine, after the website is live)
./deploy/build-apk.sh https://yourdomain.in
```

The master guide with the order-of-operations, gotchas, and pre-demo checklist
is in [`../docs/PRODUCTION-DEPLOY.md`](../docs/PRODUCTION-DEPLOY.md).
