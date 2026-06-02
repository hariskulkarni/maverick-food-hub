#!/usr/bin/env bash
#
# flush-logs.sh — clear the Restaurant Manager (Flavrly) production logs.
#
# Run ON THE VPS:   bash ~/apps/flavrly/scripts/flush-logs.sh
# Or over SSH:      ssh deploy@<vps> 'bash ~/apps/flavrly/scripts/flush-logs.sh'
#
# It does two things, both safe to re-run:
#   1. `pm2 flush <app>` — clears pm2's own captured stdout/stderr buffers.
#   2. truncates the on-disk log files to 0 bytes (the files pm2 tails).
#
# pm2 lives behind nvm, which a non-interactive SSH shell doesn't load by
# default (that's why a bare `pm2 flush` reports "command not found"). We source
# nvm first so pm2 is on PATH; if pm2 still isn't found we fall back to
# truncating the files directly, which is all that's strictly required.

set -uo pipefail

PM2_APP="${PM2_APP:-rm-web}"
LOG_DIR="${LOG_DIR:-/var/log/restaurant-manager}"

echo "== Flushing logs for '$PM2_APP' =="

# ── Make nvm / pm2 available over non-interactive SSH ────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi

# ── 1. pm2 flush (clears pm2's buffered logs) ────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
  pm2 flush "$PM2_APP" && echo "  pm2 flush '$PM2_APP' ✓"
else
  echo "  (pm2 not on PATH — skipping pm2 flush, truncating files directly)"
fi

# ── 2. Truncate the on-disk log files ────────────────────────────────────────
if [ -d "$LOG_DIR" ]; then
  shopt -s nullglob
  files=("$LOG_DIR"/*.log)
  if [ ${#files[@]} -gt 0 ]; then
    for f in "${files[@]}"; do
      # `truncate` needs write permission; fall back to sudo if available.
      if truncate -s 0 "$f" 2>/dev/null || { command -v sudo >/dev/null 2>&1 && sudo truncate -s 0 "$f"; }; then
        echo "  truncated $f ✓"
      else
        echo "  (!) could not truncate $f — check permissions"
      fi
    done
  else
    echo "  (no .log files found in $LOG_DIR)"
  fi
else
  echo "  (!) log dir $LOG_DIR not found — set LOG_DIR=... if it lives elsewhere"
fi

echo "== Done. Tail to confirm: pm2 logs $PM2_APP --lines 5 --nostream =="
