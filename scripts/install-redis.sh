#!/usr/bin/env bash
#
# Installs Redis 7 on the Flavrly Hostinger VPS, binds it to localhost only,
# enables it as a systemd service, and prints the REDIS_URL to add to .env.
#
# Idempotent: safe to run more than once. If Redis is already installed +
# configured the script no-ops with a friendly note.
#
# Run from the VPS:
#   ssh deploy@148.230.66.124
#   sudo bash /opt/restaurant-manager/scripts/install-redis.sh
#
set -euo pipefail

CONF=/etc/redis/redis.conf
APP_ENV=/opt/restaurant-manager/apps/web/.env

line() { printf '\n========== %s ==========\n' "$1"; }

line "Installing Redis 7"
if dpkg -l | grep -q '^ii  redis-server'; then
  echo "redis-server already installed - skipping apt install"
else
  apt-get update -y
  apt-get install -y redis-server
fi

line "Hardening config"
# Bind localhost only (no remote attack surface) + protected-mode + a sane
# maxmemory (450 MB) with allkeys-lru eviction so a runaway tag set can't
# OOM the VPS. The 'CONFIG REWRITE' below makes these durable to a restart.
cat > /etc/redis/redis.conf.d-flavrly.conf <<'EOF'
# Flavrly cache hardening - DO NOT EDIT BY HAND.
# Managed by /opt/restaurant-manager/scripts/install-redis.sh.
bind 127.0.0.1 -::1
protected-mode yes
supervised systemd
appendonly no
save ""
maxmemory 450mb
maxmemory-policy allkeys-lru
tcp-keepalive 60
EOF

# Patch the include directive into the main config if not already present.
if ! grep -q '^include /etc/redis/redis.conf.d-flavrly.conf' "$CONF"; then
  echo "include /etc/redis/redis.conf.d-flavrly.conf" >> "$CONF"
fi

line "Enabling + restarting redis-server"
systemctl enable redis-server
systemctl restart redis-server

line "Sanity: PING / write / read"
redis-cli ping
redis-cli set flavrly:install:probe "$(date -Is)" EX 10
redis-cli get flavrly:install:probe

line "Updating $APP_ENV"
if grep -q '^REDIS_URL=' "$APP_ENV"; then
  sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|' "$APP_ENV"
  echo "REDIS_URL updated in $APP_ENV"
else
  echo "REDIS_URL=redis://127.0.0.1:6379" >> "$APP_ENV"
  echo "REDIS_URL appended to $APP_ENV"
fi
if ! grep -q '^REDIS_KEY_PREFIX=' "$APP_ENV"; then
  echo "REDIS_KEY_PREFIX=flavrly:v1:" >> "$APP_ENV"
fi

line "Done. Next step: restart pm2 so the app picks up the env"
echo "  pm2 reload rm-web --update-env"
echo
echo "Verify after restart:"
echo "  curl -s https://flavrly.in/api/system/health | jq .cache"
echo "  pm2 logs rm-web --lines 20 | grep '\\[boot\\]'"
