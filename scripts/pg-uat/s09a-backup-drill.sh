#!/usr/bin/env bash
# S9 part A: backup / restore drill on the local UAT DB (DEPLOYMENT_AND_ROLLBACK.md section 5).
# pg_dump ci_uat -> restore into a NEW database -> prisma migrate status/deploy on the restored copy ->
# per-table row counts must equal the source -> integrity checks -> drop the restore DB.
# The dump itself stays in $UAT_DIR (contains synthetic data + throwaway-key ciphertext); only its
# hash/size and the comparison go to evidence.
set -euo pipefail
. "$(dirname "$0")/env.sh"
OUT="$EVID/s09-rollback-and-flag"; mkdir -p "$OUT"; LOG="$OUT/backup-drill.log"
P=(-h localhost -p 55432 -U ci)
counts() { psql "${P[@]}" -d "$1" -X -At -c "select string_agg(format('select %L as t, count(*) as n from %I', tablename, tablename), ' union all ') from pg_tables where schemaname='public'" | psql "${P[@]}" -d "$1" -X -At -F '|' | sort; }
{
echo "== backup drill $(date -u +%FT%TZ)"
t0=$(date +%s)
pg_dump "${P[@]}" -Fc -d ci_uat -f "$UAT_DIR/ci_uat.dump"
t1=$(date +%s)
echo "pg_dump exit=0 secs=$((t1-t0)) size=$(stat -f %z "$UAT_DIR/ci_uat.dump") sha256=$(shasum -a 256 "$UAT_DIR/ci_uat.dump" | cut -c1-64)"
counts ci_uat > "$OUT/counts-source.txt"
dropdb "${P[@]}" --if-exists ci_uat_restore; createdb "${P[@]}" ci_uat_restore
pg_restore "${P[@]}" --no-owner -d ci_uat_restore "$UAT_DIR/ci_uat.dump"; echo "pg_restore exit=$?"
t2=$(date +%s)
cd "$WT_APP/apps/web"
DATABASE_URL='postgresql://ci@localhost:55432/ci_uat_restore?schema=public' ./node_modules/.bin/prisma migrate status 2>&1 | tail -4
DATABASE_URL='postgresql://ci@localhost:55432/ci_uat_restore?schema=public' ./node_modules/.bin/prisma migrate deploy 2>&1 | tail -2
DATABASE_URL='postgresql://ci@localhost:55432/ci_uat_restore?schema=public' ./node_modules/.bin/prisma migrate diff --from-url 'postgresql://ci@localhost:55432/ci_uat_restore?schema=public' --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1 && echo "schema drift vs schema.prisma: none (exit 0)" || echo "schema drift vs schema.prisma: exit $?"
t3=$(date +%s)
echo "restore+migrate secs=$((t3-t1)) (RTO estimate for this data size)"
counts ci_uat_restore > "$OUT/counts-restore.txt"
if diff -q "$OUT/counts-source.txt" "$OUT/counts-restore.txt" >/dev/null; then echo "ROW COUNTS EQUAL across $(wc -l < "$OUT/counts-source.txt" | tr -d ' ') tables: PASS"; else echo "ROW COUNTS DIFFER: FAIL"; diff "$OUT/counts-source.txt" "$OUT/counts-restore.txt" || true; fi
echo "-- integrity on restored copy"
psql "${P[@]}" -d ci_uat_restore -X -c "select count(*) as dup_bank_txn_allocations from (select \"bankTransactionId\" from \"PgAllocation\" where \"reversedAt\" is null group by 1 having count(*)>1) x"
psql "${P[@]}" -d ci_uat_restore -X -c "select p.status, count(*) from \"Payment\" p where \"providerName\"='youpi' group by 1 order by 1"
psql "${P[@]}" -d ci_uat_restore -X -c "select (select coalesce(sum(\"amountPaise\"),0) from \"PgAllocation\" where \"reversedAt\" is null) as alloc_paise, (select coalesce(sum(\"amountPaise\"),0) from \"PgBankTransaction\" where status='ALLOCATED') as allocated_credit_paise, (select coalesce(sum(\"amountPaise\"),0) from \"PgFinancialEvent\" where kind='PAYMENT_CAPTURED') as captured_event_paise"
psql "${P[@]}" -d ci_uat_restore -X -c "select count(*) as finevent_rows from \"PgFinancialEvent\""
psql "${P[@]}" -d ci_uat_restore -X -c "update \"PgFinancialEvent\" set kind=kind where false" >/dev/null && echo "append-only trigger present: $(psql "${P[@]}" -d ci_uat_restore -X -At -c "select count(*) from pg_trigger where tgrelid='\"PgFinancialEvent\"'::regclass and not tgisinternal")"
dropdb "${P[@]}" ci_uat_restore && echo "restore DB dropped"
} 2>&1 | tee "$LOG"
