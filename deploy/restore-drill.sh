#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Restore drill (threat model T-22, OPERATIONS_RUNBOOK §5)
#
#  Usage:  deploy/restore-drill.sh <throwaway_db_name> [--keep]
#
#  Restores the newest backup written by deploy/backup.sh (daily/ or weekly/,
#  plaintext .dump.gz, .dump.gz.age or .dump.gz.gpg) into a NEW database named
#  <throwaway_db_name>, prints row counts for key tables, checks basic money
#  invariants, and drops the database again unless --keep is given.
#
#  Safety:
#    - refuses a target name equal to the production DB_NAME
#    - refuses a target that already exists (createdb fails; nothing is dropped)
#    - only drops the database this run created
#
#  Env (same names as backup.sh):
#    DB_NAME (production name to protect, default restaurant_manager)
#    DB_HOST DB_PORT DB_USER   — server to restore INTO (use a non-prod server/port)
#    BACKUP_DIR                — where backup.sh writes (default /var/backups/restaurant-manager)
#    BACKUP_FILE               — restore this file instead of the newest one
#    BACKUP_AGE_IDENTITY       — age identity file for .age backups (age -d -i)
#    (.gpg backups use the caller's gpg keyring)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

usage() { echo "usage: $0 <throwaway_db_name> [--keep]" >&2; exit 2; }

TARGET=""
KEEP=0
for arg in "$@"; do
    case "$arg" in
        --keep) KEEP=1 ;;
        -*) usage ;;
        *) [ -z "$TARGET" ] || usage; TARGET="$arg" ;;
    esac
done
[ -n "$TARGET" ] || usage

DB_NAME="${DB_NAME:-restaurant_manager}"
DB_USER="${DB_USER:-restaurant_manager}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/restaurant-manager}"
BACKUP_FILE="${BACKUP_FILE:-}"
BACKUP_AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-}"

if ! [[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
    echo "ERROR: target name must match ^[a-z_][a-z0-9_]*\$ (got '$TARGET')" >&2; exit 2
fi
if [ "$TARGET" = "$DB_NAME" ]; then
    echo "ERROR: refusing to restore into '$TARGET': it equals the production DB_NAME" >&2; exit 2
fi

log() { echo "[$(date -Iseconds)] $*"; }
CONN=(--host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER")

# ── Pick the backup ─────────────────────────────────────────────────────────
if [ -z "$BACKUP_FILE" ]; then
    # Newest by modification time across daily/ and weekly/.
    BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/daily/rm-*.dump.gz* "$BACKUP_DIR"/weekly/rm-*.dump.gz* 2>/dev/null \
        | grep -E '\.dump\.gz(\.age|\.gpg)?$' | head -n 1 || true)"
fi
[ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ] || { echo "ERROR: no backup found under $BACKUP_DIR" >&2; exit 1; }
log "backup: $BACKUP_FILE"

decrypt_stream() {   # writes the gzip'd custom-format dump to stdout
    case "$BACKUP_FILE" in
        *.age)
            [ -n "$BACKUP_AGE_IDENTITY" ] || { echo "ERROR: .age backup needs BACKUP_AGE_IDENTITY" >&2; return 1; }
            age -d -i "$BACKUP_AGE_IDENTITY" "$BACKUP_FILE" ;;
        *.gpg) gpg --batch --quiet --decrypt "$BACKUP_FILE" ;;
        *)     cat "$BACKUP_FILE" ;;
    esac
}

# ── Restore ─────────────────────────────────────────────────────────────────
WORK="$(mktemp -d)"
CREATED=0
cleanup() {
    rm -rf "$WORK"
    if [ "$CREATED" = "1" ] && [ "$KEEP" != "1" ]; then
        dropdb "${CONN[@]}" --if-exists "$TARGET" && log "dropped $TARGET"
    fi
}
trap cleanup EXIT

START=$(date +%s)
decrypt_stream | gunzip -c > "$WORK/restore.dump"
createdb "${CONN[@]}" "$TARGET"
CREATED=1
log "created $TARGET"
pg_restore "${CONN[@]}" --no-owner --no-privileges --exit-on-error -d "$TARGET" "$WORK/restore.dump"
log "restore finished in $(( $(date +%s) - START ))s"

# ── Sanity checks ───────────────────────────────────────────────────────────
q() { psql "${CONN[@]}" -d "$TARGET" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
FAIL=0
for t in Order Payment PgPaymentAttempt PgAllocation PgFinancialEvent; do
    if [ "$(q "SELECT to_regclass('public.\"$t\"') IS NOT NULL")" = "t" ]; then
        log "count \"$t\" = $(q "SELECT count(*) FROM \"$t\"")"
    else
        log "FAIL: table \"$t\" is missing"; FAIL=1
    fi
done
if [ "$FAIL" = "0" ]; then
    log "Payment by status: $(q "SELECT coalesce(string_agg(status::text || '=' || n, ' '), '(none)') FROM (SELECT status, count(*) n FROM \"Payment\" GROUP BY status ORDER BY status) s")"
    DUP=$(q "SELECT count(*) FROM (SELECT \"bankTransactionId\" FROM \"PgAllocation\" GROUP BY 1 HAVING count(*) > 1) d")
    if [ "$DUP" != "0" ]; then log "FAIL: $DUP bankTransactionId values allocated more than once"; FAIL=1; fi
fi

if [ "$KEEP" = "1" ]; then log "kept $TARGET (--keep); drop it yourself when done"; fi
if [ "$FAIL" != "0" ]; then log "restore drill FAILED"; exit 1; fi
log "restore drill OK"
