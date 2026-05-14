#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Restaurant Manager — pg_dump rotation
#
#  Layout:
#    $BACKUP_DIR/daily/   — last 7 daily dumps
#    $BACKUP_DIR/weekly/  — last 4 Sunday weekly dumps
#
#  Each dump is gzip-compressed `pg_dump -Fc`. The script is idempotent: run it
#  multiple times in the same day and it will overwrite the day's file.
#
#  If RCLONE_REMOTE is set (e.g. "b2:restaurant-manager-backups"), the dump is
#  also pushed off-host via rclone after a successful local dump.
#
#  Cron suggestion (run as the postgres user or a backup user):
#    15 2 * * *  /opt/restaurant-manager/deploy/backup.sh >> /var/log/rm-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config (override via env) ───────────────────────────────────────────────
DB_NAME="${DB_NAME:-restaurant_manager}"
DB_USER="${DB_USER:-restaurant_manager}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/restaurant-manager}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"          # e.g. "b2:rm-backups" — empty to skip
RCLONE_PATH="${RCLONE_PATH:-restaurant-manager}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
LAST_BACKUP_MARKER="${LAST_BACKUP_MARKER:-/var/lib/restaurant-manager/last-backup.txt}"

# ── Setup ───────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
mkdir -p "$(dirname "$LAST_BACKUP_MARKER")"

DATE="$(date +%F)"          # YYYY-MM-DD
DOW="$(date +%u)"           # 1..7, Mon=1 Sun=7
DAILY_FILE="$BACKUP_DIR/daily/rm-${DATE}.dump.gz"
WEEKLY_FILE="$BACKUP_DIR/weekly/rm-${DATE}.dump.gz"

echo "[$(date -Iseconds)] starting backup of $DB_NAME → $DAILY_FILE"

# ── Dump ────────────────────────────────────────────────────────────────────
# `-Fc` is the custom (compressed) format; we still gzip to keep file naming
# consistent across formats and to make off-host transfer trivial.
PG_DUMP_ARGS=(
    --host="$DB_HOST"
    --port="$DB_PORT"
    --username="$DB_USER"
    --no-owner
    --no-privileges
    --format=custom
    "$DB_NAME"
)

# Write atomically — dump to .tmp then move once gzip succeeds
TMP_FILE="${DAILY_FILE}.tmp"
pg_dump "${PG_DUMP_ARGS[@]}" | gzip -c -9 > "$TMP_FILE"
mv "$TMP_FILE" "$DAILY_FILE"
echo "[$(date -Iseconds)] daily dump complete: $(du -h "$DAILY_FILE" | cut -f1)"

# Sunday → also copy to weekly
if [ "$DOW" = "7" ]; then
    cp -f "$DAILY_FILE" "$WEEKLY_FILE"
    echo "[$(date -Iseconds)] weekly snapshot saved: $WEEKLY_FILE"
fi

# ── Rotate ──────────────────────────────────────────────────────────────────
# Keep newest $KEEP_DAILY in daily, newest $KEEP_WEEKLY in weekly.
rotate() {
    local dir="$1" keep="$2"
    find "$dir" -maxdepth 1 -type f -name 'rm-*.dump.gz' -printf '%T@ %p\n' \
        | sort -rn \
        | awk -v keep="$keep" 'NR>keep {print $2}' \
        | xargs -r rm -f
}
rotate "$BACKUP_DIR/daily"  "$KEEP_DAILY"
rotate "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
echo "[$(date -Iseconds)] rotation done (daily=$KEEP_DAILY, weekly=$KEEP_WEEKLY)"

# ── Off-host push (optional) ────────────────────────────────────────────────
if [ -n "$RCLONE_REMOTE" ]; then
    if command -v rclone >/dev/null 2>&1; then
        echo "[$(date -Iseconds)] uploading to ${RCLONE_REMOTE}/${RCLONE_PATH}"
        rclone copy "$BACKUP_DIR/daily"  "${RCLONE_REMOTE}/${RCLONE_PATH}/daily"  --transfers=2 --checkers=2 --retries=3
        rclone copy "$BACKUP_DIR/weekly" "${RCLONE_REMOTE}/${RCLONE_PATH}/weekly" --transfers=2 --checkers=2 --retries=3
        # Mirror retention on the remote
        rclone delete "${RCLONE_REMOTE}/${RCLONE_PATH}/daily"  --min-age "${KEEP_DAILY}d"  --rmdirs || true
        rclone delete "${RCLONE_REMOTE}/${RCLONE_PATH}/weekly" --min-age "$((KEEP_WEEKLY*7))d" --rmdirs || true
        echo "[$(date -Iseconds)] off-host upload complete"
    else
        echo "[$(date -Iseconds)] WARN: RCLONE_REMOTE set but rclone is not installed; skipping upload"
    fi
fi

# ── Marker for system-health page ───────────────────────────────────────────
date -Iseconds > "$LAST_BACKUP_MARKER"
echo "[$(date -Iseconds)] last-backup marker written to $LAST_BACKUP_MARKER"
echo "[$(date -Iseconds)] done."
