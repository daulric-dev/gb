#!/usr/bin/env bash
# backup-verify: prove the latest (or a given) backup restores.
#
# Creates a throwaway database, restores the backup into it with
# backup-restore, runs sanity checks, prints row counts and drops the database
# again (also on failure).
#
# Usage:
#   backup-verify [--key daily/YYYY/MM/<file>] [--identity <file>] [--keep]
#
# Needs:
#   BACKUP_VERIFY_DATABASE_URL  a role that may CREATE DATABASE, on a server
#                               that is NOT production if you can help it
#                               (a scratch Postgres 18). The database in the
#                               URL is only used to run CREATE/DROP DATABASE.
#   BACKUP_AGE_IDENTITY_FILE    (or --identity) the age private key. Prefer
#                               running verify on a separate machine that holds
#                               a dedicated verification key (see BACKUPS.md).
#   BACKUP_S3_*                 as for backups (read access is enough)
#
# Checks: restore succeeds, `_prisma_migrations` exists with applied
# migrations and none failed, the app schemas have tables. Exit 0 = pass.
source /opt/backup/common.sh

KEY=""
IDENTITY="${BACKUP_AGE_IDENTITY_FILE:-}"
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key) KEY="${2:?--key needs an object key}"; shift 2 ;;
    --latest) KEY=""; shift ;;
    --identity) IDENTITY="${2:?--identity needs a file}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

file_env BACKUP_VERIFY_DATABASE_URL
ADMIN_URL="${BACKUP_VERIFY_DATABASE_URL:-}"
[[ -n "$ADMIN_URL" ]] || die "BACKUP_VERIFY_DATABASE_URL is not set (a role that may CREATE DATABASE on a scratch server)"
ADMIN_URL="$(libpq_url "$ADMIN_URL")"
load_s3_config

acquire_lock verify
hc_ping BACKUP_VERIFY_HEALTHCHECK_URL /start

if [[ -z "$KEY" ]]; then
  KEY="$(latest_backup_key)"
  [[ -n "$KEY" ]] || die "no complete backup found under $BACKUP_DISPLAY/daily"
fi

DB="gb_verify_$(date -u +%Y%m%d%H%M%S)_$$"
TARGET="$(url_with_db "$ADMIN_URL" "$DB")"
CREATED=0
STAGE="create"

on_exit() {
  local rc=$?
  if [[ "$CREATED" == 1 && "$KEEP" != 1 ]]; then
    if psql "$ADMIN_URL" -XAtq -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\" with (force)" >/dev/null 2>&1; then
      info "dropped throwaway database $DB"
    else
      warn "could not drop throwaway database $DB: drop it by hand"
    fi
  fi
  if [[ $rc -ne 0 && $rc -ne 75 ]]; then
    log ERROR "verify FAILED during '$STAGE' (exit $rc)"
    hc_ping BACKUP_VERIFY_HEALTHCHECK_URL /fail "verify of $KEY failed during '$STAGE' (exit $rc)"
  fi
}
trap on_exit EXIT

info "verifying $KEY in throwaway database $DB on $(describe_url "$ADMIN_URL" | sed 's#/.*##')"
psql "$ADMIN_URL" -XAtq -v ON_ERROR_STOP=1 -c "create database \"$DB\"" >/dev/null
CREATED=1

STAGE="restore"
restore_args=(--target "$TARGET" --key "$KEY")
[[ -n "$IDENTITY" ]] && restore_args+=(--identity "$IDENTITY")
/opt/backup/restore.sh "${restore_args[@]}"

STAGE="checks"
q() { psql "$TARGET" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }

[[ "$(q "select to_regclass('public._prisma_migrations') is not null")" == "t" ]] || die "_prisma_migrations is missing"
APPLIED="$(q "select count(*) from public._prisma_migrations where finished_at is not null and rolled_back_at is null")"
FAILED="$(q "select count(*) from public._prisma_migrations where finished_at is null and rolled_back_at is null")"
LAST="$(q "select migration_name from public._prisma_migrations where finished_at is not null order by finished_at desc, migration_name desc limit 1")"
[[ "$APPLIED" -gt 0 ]] || die "_prisma_migrations has no applied migrations"
[[ "$FAILED" -eq 0 ]] || die "_prisma_migrations has $FAILED unfinished/failed migration(s)"
info "migrations: $APPLIED applied, latest $LAST"

TABLES="$(q "select count(*) from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')")"
[[ "$TABLES" -gt 1 ]] || die "only $TABLES table(s) restored"

# Exact row counts for every table (schema.table rows), largest first.
COUNTS="$(q "
  select format('%s.%s', table_schema, table_name), (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
  from information_schema.tables
  where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
  order by 2 desc, 1")"
TOTAL_ROWS="$(printf '%s\n' "$COUNTS" | awk -F'|' '{s += $2} END {print s + 0}')"
info "restored $TABLES tables, $TOTAL_ROWS rows. Row counts (schema.table|rows):"
printf '%s\n' "$COUNTS" >&2

STAGE="done"
[[ "$KEEP" == 1 ]] && info "--keep: throwaway database $DB was left in place"
info "verify OK: $KEY"
hc_ping BACKUP_VERIFY_HEALTHCHECK_URL "" "ok $KEY tables=$TABLES rows=$TOTAL_ROWS migrations=$APPLIED"
