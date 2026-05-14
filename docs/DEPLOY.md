# Deploy guide

The app ships as a single Next.js 15 instance + a Postgres database. Same Docker image runs everywhere.

## Environment variables

```
# Required
DATABASE_URL=postgresql://user:pass@host:5432/restaurant
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain

# Adapters — all optional in dev (mocks used)
PAYMENT_PROVIDER=razorpay         # or "mock"
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

NOTIFIER_SMS=twilio               # or "mock"
NOTIFIER_WHATSAPP=twilio_whatsapp # or "mock"
NOTIFIER_EMAIL=smtp               # or "mock"
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=...
TWILIO_WHATSAPP_FROM=whatsapp:+...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="Restaurant <noreply@restaurant.com>"

GOOGLE_MAPS_API_KEY=...           # rider navigation, customer map preview

STORAGE_DRIVER=s3                 # or "local"
S3_BUCKET=...
S3_REGION=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

## Local development

```
docker compose up --build
# app → http://localhost:3000
# postgres → localhost:5432 (user: postgres / pass: postgres / db: restaurant)
```

## Vercel

1. Connect the repo, set the project root to `apps/web`.
2. Add all env vars above (use Vercel Postgres or Neon for `DATABASE_URL`).
3. Set the build command to `npm run build` and add `npx prisma migrate deploy && npm run build` in a Vercel build hook so migrations run on deploy.

## Railway / Render / Fly

Use the supplied `Dockerfile`. Provision a managed Postgres, set env vars. Health check on `/api/health`.

## Self-hosted (any VPS)

```
git clone ...
cd "Restaurant Manager"
cp apps/web/.env.example .env  # fill values
docker compose -f docker-compose.prod.yml up -d
```

Front with Caddy or Nginx for TLS.

## Migrations in production

```
docker compose run --rm web npx prisma migrate deploy
```

Or include it as a release-phase step in your platform of choice.
