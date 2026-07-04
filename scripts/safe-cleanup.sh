#!/usr/bin/env bash
#
# safe-cleanup.sh — reclaim CACHE + LOG disk on the Flavrly VPS.
#
# SAFETY MODEL: allowlist, not denylist. This script ONLY touches a fixed set
# of cache/log paths listed below. It has no `find / -delete`, no wildcards over
# data dirs, and it NEVER touches any of these:
#     • public/uploads, public/banners, public/downloads   (restaurant images)
#     • /var/www/restaurant-manager/uploads                 (nginx-served images)
#     • the Postgres data directory                         (all app data)
#     • .env / .env.demo                                    (secrets/config)
#     • .next  (only .next/CACHE is cleared, never the built app)
#
# Run ON THE VPS:
#     bash /opt/restaurant-manager/scripts/safe-cleanup.sh
# Preview WITHOUT changing anything:
#     DRY_RUN=1 bash /opt/restaurant-manager/scripts/safe-cleanup.sh
#
# Re-runnable any time. Clearing these caches/logs is non-destructive: Next
# rebuilds its cache on the next deploy, npm re-downloads on demand, and logs
# simply start fresh.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager/apps/web}"
PM2_LOG_DIR="${PM2_LOG_DIR:-/var/log/restaurant-manager}"
DRY_RUN="${DRY_RUN:-0}"

run() {                      # run <description> <command...>
  local desc="$1"; shift
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] would: $desc"
  else
    if "$@"; then echo "  ✓ $desc"; else echo "  (!) skipped/failed: $desc"; fi
  fi
}

# Prefer sudo only when we actually lack write permission and sudo exists.
maybe_sudo() { if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then sudo "$@"; else "$@"; fi; }

echo "════════════════════════════════════════════════════════════"
echo " Flavrly safe cleanup  (DRY_RUN=$DRY_RUN)"
echo "════════════════════════════════════════════════════════════"
echo
echo "── Disk before ─────────────────────────────────────────────"
df -h / 2>/dev/null | awk 'NR==1 || /\/$/'
echo
echo "── What's using space (top dirs) ───────────────────────────"
maybe_sudo du -h -d1 /opt /var/www /var/log /var/lib 2>/dev/null | sort -h | tail -15
echo
echo "── Protected (NOT touched) — sizes shown so you can confirm ─"
for p in "$APP_DIR/public/uploads" "$APP_DIR/public/banners" "$APP_DIR/public/downloads" "/var/www/restaurant-manager/uploads"; do
  [ -e "$p" ] && echo "  keep: $(maybe_sudo du -sh "$p" 2>/dev/null)"
done
echo

echo "── 1. Next.js build cache (.next/cache) ────────────────────"
if [ -d "$APP_DIR/.next/cache" ]; then
  echo "  size: $(du -sh "$APP_DIR/.next/cache" 2>/dev/null | cut -f1)"
  run "clear $APP_DIR/.next/cache" rm -rf "$APP_DIR/.next/cache"
else
  echo "  (no .next/cache — nothing to do)"
fi
echo

echo "── 2. npm cache ────────────────────────────────────────────"
if command -v npm >/dev/null 2>&1; then
  run "npm cache clean --force" npm cache clean --force
elif [ -d "$HOME/.npm/_cacache" ]; then
  run "rm ~/.npm/_cacache" rm -rf "$HOME/.npm/_cacache"
else
  echo "  (no npm cache found)"
fi
echo

echo "── 3. PM2 captured logs + on-disk log files ────────────────"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
if command -v pm2 >/dev/null 2>&1; then
  run "pm2 flush" pm2 flush
else
  echo "  (pm2 not on PATH — truncating files directly)"
fi
if [ -d "$PM2_LOG_DIR" ]; then
  shopt -s nullglob
  for f in "$PM2_LOG_DIR"/*.log; do run "truncate $f" maybe_sudo truncate -s 0 "$f"; done
fi
echo

echo "── 4. nginx logs (truncate active, remove rotated) ─────────"
shopt -s nullglob
for f in /var/log/nginx/*.log; do run "truncate $f" maybe_sudo truncate -s 0 "$f"; done
for f in /var/log/nginx/*.gz /var/log/nginx/*.[0-9]; do run "remove rotated $f" maybe_sudo rm -f "$f"; done
echo

echo "── 5. systemd journal (cap at 200M) ────────────────────────"
if command -v journalctl >/dev/null 2>&1; then
  run "journalctl --vacuum-size=200M" maybe_sudo journalctl --vacuum-size=200M
else
  echo "  (journalctl not present)"
fi
echo

echo "── 6. apt package cache ────────────────────────────────────"
if command -v apt-get >/dev/null 2>&1; then
  run "apt-get clean" maybe_sudo apt-get clean
else
  echo "  (apt not present)"
fi
echo

echo "── 7. rotated system logs (*.gz) ───────────────────────────"
for f in /var/log/*.gz; do run "remove $f" maybe_sudo rm -f "$f"; done
echo

echo "════════════════════════════════════════════════════════════"
echo "── Disk after ──────────────────────────────────────────────"
df -h / 2>/dev/null | awk 'NR==1 || /\/$/'
echo
echo "Done. Images, database, and .env were not touched."
echo "If space is still high, run this to find the biggest offenders:"
echo "  sudo du -h -d2 /opt /var/lib /var/log 2>/dev/null | sort -h | tail -25"
