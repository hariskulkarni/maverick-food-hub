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
#  Encryption (threat model T-22): only ENCRYPTED copies leave the host.
#    BACKUP_AGE_RECIPIENT=age1...      → writes rm-<date>.dump.gz.age (age -r)
#    BACKUP_GPG_RECIPIENT=<key id>     → writes rm-<date>.dump.gz.gpg (gpg --encrypt)
#  (age wins if both are set.) The plaintext dump stays on this host only. With
#  RCLONE_REMOTE set and no recipient, the off-host copy is REFUSED (non-zero
#  exit after the local backup is made) unless BACKUP_ALLOW_PLAINTEXT_OFFHOST=1.
#  The private key is held offline by the owner; see deploy/restore-drill.sh.
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
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"   # age public key (age1...)
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"   # gpg key id / email (public key imported)
BACKUP_ALLOW_PLAINTEXT_OFFHOST="${BACKUP_ALLOW_PLAINTEXT_OFFHOST:-0}"

# ── Encryption mode ─────────────────────────────────────────────────────────
ENC_EXT=""
if [ -n "$BACKUP_AGE_RECIPIENT" ]; then
    command -v age >/dev/null 2>&1 || { echo "ERROR: BACKUP_AGE_RECIPIENT set but age is not installed" >&2; exit 1; }
    ENC_EXT=".age"
elif [ -n "$BACKUP_GPG_RECIPIENT" ]; then
    command -v gpg >/dev/null 2>&1 || { echo "ERROR: BACKUP_GPG_RECIPIENT set but gpg is not installed" >&2; exit 1; }
    ENC_EXT=".gpg"
fi

encrypt_to() {   # encrypt_to <in> <out>; writes atomically
    local in="$1" out="$2"
    if [ "$ENC_EXT" = ".age" ]; then
        age -r "$BACKUP_AGE_RECIPIENT" -o "${out}.tmp" "$in"
    else
        gpg --batch --yes --trust-model always --encrypt \
            --recipient "$BACKUP_GPG_RECIPIENT" --output "${out}.tmp" "$in"
    fi
    mv "${out}.tmp" "$out"
}

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
if [ -n "$ENC_EXT" ]; then
    encrypt_to "$DAILY_FILE" "${DAILY_FILE}${ENC_EXT}"
    echo "[$(date -Iseconds)] encrypted copy written: ${DAILY_FILE}${ENC_EXT}"
fi

# Sunday → also copy to weekly
if [ "$DOW" = "7" ]; then
    cp -f "$DAILY_FILE" "$WEEKLY_FILE"
    if [ -n "$ENC_EXT" ]; then cp -f "${DAILY_FILE}${ENC_EXT}" "${WEEKLY_FILE}${ENC_EXT}"; fi
    echo "[$(date -Iseconds)] weekly snapshot saved: $WEEKLY_FILE"
fi

# ── Rotate ──────────────────────────────────────────────────────────────────
# Keep newest $KEEP_DAILY in daily, newest $KEEP_WEEKLY in weekly, per file
# kind (plaintext, .age, .gpg). File names are rm-YYYY-MM-DD..., so a reverse
# name sort is newest-first (portable; no GNU find -printf).
rotate() {
    local dir="$1" keep="$2" pattern
    for pattern in 'rm-*.dump.gz' 'rm-*.dump.gz.age' 'rm-*.dump.gz.gpg'; do
        find "$dir" -maxdepth 1 -type f -name "$pattern" \
            | sort -r \
            | awk -v keep="$keep" 'NR>keep' \
            | while IFS= read -r f; do rm -f -- "$f"; done
    done
}
rotate "$BACKUP_DIR/daily"  "$KEEP_DAILY"
rotate "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
echo "[$(date -Iseconds)] rotation done (daily=$KEEP_DAILY, weekly=$KEEP_WEEKLY)"

# ── Marker for system-health page (the local backup exists at this point) ──
date -Iseconds > "$LAST_BACKUP_MARKER"
echo "[$(date -Iseconds)] last-backup marker written to $LAST_BACKUP_MARKER"

# ── Off-host push (optional) ────────────────────────────────────────────────
if [ -n "$RCLONE_REMOTE" ]; then
    if [ -n "$ENC_EXT" ]; then
        UPLOAD_GLOB="rm-*.dump.gz${ENC_EXT}"
    elif [ "$BACKUP_ALLOW_PLAINTEXT_OFFHOST" = "1" ]; then
        UPLOAD_GLOB="rm-*.dump.gz"
        echo "[$(date -Iseconds)] WARN: BACKUP_ALLOW_PLAINTEXT_OFFHOST=1 — uploading UNENCRYPTED dumps"
    else
        echo "[$(date -Iseconds)] ERROR: RCLONE_REMOTE is set but neither BACKUP_AGE_RECIPIENT nor BACKUP_GPG_RECIPIENT is configured." >&2
        echo "[$(date -Iseconds)] ERROR: refusing to copy an unencrypted dump off-host (T-22). Local backup kept at $DAILY_FILE." >&2
        echo "[$(date -Iseconds)] ERROR: set a recipient, or BACKUP_ALLOW_PLAINTEXT_OFFHOST=1 to override." >&2
        exit 3
    fi
    if command -v rclone >/dev/null 2>&1; then
        echo "[$(date -Iseconds)] uploading ${UPLOAD_GLOB} to ${RCLONE_REMOTE}/${RCLONE_PATH}"
        rclone copy "$BACKUP_DIR/daily"  "${RCLONE_REMOTE}/${RCLONE_PATH}/daily"  --include "$UPLOAD_GLOB" --transfers=2 --checkers=2 --retries=3
        rclone copy "$BACKUP_DIR/weekly" "${RCLONE_REMOTE}/${RCLONE_PATH}/weekly" --include "$UPLOAD_GLOB" --transfers=2 --checkers=2 --retries=3
        # Mirror retention on the remote
        rclone delete "${RCLONE_REMOTE}/${RCLONE_PATH}/daily"  --min-age "${KEEP_DAILY}d"  --rmdirs || true
        rclone delete "${RCLONE_REMOTE}/${RCLONE_PATH}/weekly" --min-age "$((KEEP_WEEKLY*7))d" --rmdirs || true
        echo "[$(date -Iseconds)] off-host upload complete"
    else
        echo "[$(date -Iseconds)] WARN: RCLONE_REMOTE set but rclone is not installed; skipping upload"
    fi
fi

echo "[$(date -Iseconds)] done."
