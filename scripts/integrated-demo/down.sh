#!/usr/bin/env bash
# Integrated demo — stop every process, drop all demo data and remove the scratch worktrees.
# Keeps the recorded evidence in $DEMO_OUT. Pass --keep-worktrees to keep the scratch checkouts.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/demo.conf"
for name in fl-cron fl-web nq-web nq-api; do
  if [ -f "$STATE/$name.pid" ]; then pkill -P "$(cat "$STATE/$name.pid")" 2>/dev/null; kill "$(cat "$STATE/$name.pid")" 2>/dev/null; fi
done
pkill -f "$NQ_WT/apps/api" 2>/dev/null; pkill -f "$NQ_WT/apps/web" 2>/dev/null; pkill -f "$FL_WT/apps/web" 2>/dev/null
redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null
[ -d "$STATE/pg" ] && pg_ctl -D "$STATE/pg" -m fast stop >/dev/null 2>&1
rm -rf "$STATE"
if [ "${1:-}" != "--keep-worktrees" ]; then
  [ -d "$NQ_WT" ] && git -C "$NQ_REPO" worktree remove --force "$NQ_WT"
  [ -d "$FL_WT" ] && git -C "$FL_REPO" worktree remove --force "$FL_WT"
fi
echo "demo stack down; evidence kept in $DEMO_OUT"
