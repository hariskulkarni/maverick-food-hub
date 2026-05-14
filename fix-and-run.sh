#!/usr/bin/env bash
# One-shot fix + run for the Restaurant Manager.
# Auto-finds a free host port for docker Postgres so it never collides
# with anything else you have listening on 5432/5433/etc.

set -euo pipefail

ROOT="/Users/hkulkarni/Documents/Claude/Projects/Restaurant Manager"
WEB="$ROOT/apps/web"

cd "$ROOT"

echo "==> 1/8  Stopping any existing docker containers for this project"
docker compose down >/dev/null 2>&1 || true

echo "==> 2/8  Finding a free host port for Postgres"
PORT=""
for p in 5432 5433 5434 5435 5440 5450 5499 6432; do
  if ! lsof -i ":$p" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$p"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "Could not find a free port in the candidate list. Set POSTGRES_HOST_PORT=<port> in $ROOT/.env manually."
  exit 1
fi
echo "    selected port $PORT"

echo "==> 3/8  Writing POSTGRES_HOST_PORT=$PORT to $ROOT/.env"
if [ -f "$ROOT/.env" ]; then
  grep -v '^POSTGRES_HOST_PORT=' "$ROOT/.env" > "$ROOT/.env.tmp" && mv "$ROOT/.env.tmp" "$ROOT/.env"
fi
echo "POSTGRES_HOST_PORT=$PORT" >> "$ROOT/.env"

echo "==> 4/8  Pointing apps/web/.env DATABASE_URL at port $PORT"
if [ ! -f "$WEB/.env" ]; then
  cp "$WEB/.env.example" "$WEB/.env"
fi
sed -i '' -E "s|@localhost:[0-9]+/restaurant|@localhost:$PORT/restaurant|" "$WEB/.env"

echo "==> 5/8  Starting docker Postgres (host port $PORT → container 5432)"
docker compose up -d postgres

echo -n "==> 6/8  Waiting for Postgres to be healthy "
ok=0
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U postgres -d restaurant >/dev/null 2>&1; then
    echo " ✓"
    ok=1
    break
  fi
  echo -n "."
  sleep 1
done
if [ "$ok" -ne 1 ]; then
  echo
  echo "    Postgres did not become healthy in 30s. Last logs:"
  docker compose logs postgres --tail 30 || true
  exit 1
fi

echo "==> 7/8  Applying schema + seeding sample data"
cd "$WEB"
npm run db:push
npm run db:seed

echo "==> 8/8  Starting Next.js dev server on http://localhost:3000"
echo "    (Ctrl-C to stop. OTP codes will print here when you log in.)"
echo
( sleep 5 && open "http://localhost:3000" ) &
exec npm run dev
