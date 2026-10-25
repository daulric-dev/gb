#!/usr/bin/env bash
# backup-cron (the container's default command): check the configuration
# loudly, prove the database and bucket are reachable, then hand over to
# supercronic.
#
#   BACKUP_SCHEDULE         cron expression, default "0 4 * * *" (04:00 in TZ)
#   TZ                      time zone for the schedule, default UTC
#   BACKUP_VERIFY_SCHEDULE  optional, e.g. "0 6 * * 0" (Sundays 06:00): run
#                           backup-verify (needs BACKUP_VERIFY_DATABASE_URL and
#                           BACKUP_AGE_IDENTITY_FILE)
#   BACKUP_STARTUP_CHECK    default true: test DB + bucket access on start
#   BACKUP_RUN_ON_START     default false: take one backup right away
source /opt/backup/common.sh

info "GradeBook backup: checking configuration"
load_db_config
load_s3_config
load_encryption_config
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || die "BACKUP_RETENTION_DAYS must be a whole number of days >= 1"

SCHEDULE="${BACKUP_SCHEDULE:-0 4 * * *}"
CRONTAB="$BACKUP_STATE_DIR/crontab"
mkdir -p "$BACKUP_STATE_DIR"
printf '%s /opt/backup/backup.sh\n' "$SCHEDULE" >"$CRONTAB"

if [[ -n "${BACKUP_VERIFY_SCHEDULE:-}" ]]; then
  file_env BACKUP_VERIFY_DATABASE_URL
  [[ -n "${BACKUP_VERIFY_DATABASE_URL:-}" ]] || die "BACKUP_VERIFY_SCHEDULE is set but BACKUP_VERIFY_DATABASE_URL is not"
  [[ -r "${BACKUP_AGE_IDENTITY_FILE:-/nonexistent}" ]] || die "BACKUP_VERIFY_SCHEDULE is set but BACKUP_AGE_IDENTITY_FILE is not a readable file"
  warn "scheduled verification keeps an age private key on this host; prefer a separate verification host (see BACKUPS.md)"
  printf '%s /opt/backup/verify.sh\n' "$BACKUP_VERIFY_SCHEDULE" >>"$CRONTAB"
fi
supercronic -test "$CRONTAB" >/dev/null 2>&1 || die "invalid BACKUP_SCHEDULE/BACKUP_VERIFY_SCHEDULE: $(tr '\n' ';' <"$CRONTAB")"

if is_true "${BACKUP_STARTUP_CHECK:-true}"; then
  out="$(psql "$DB_URL" -XAtqc 'show server_version_num' 2>&1)" || die "startup check: cannot connect to the database: $(printf '%s' "$out" | head -1)"
  server_major=$((out / 10000))
  client_major="$(pg_dump --version | awk '{split($3, v, "."); print v[1]}')"
  [[ "$client_major" -ge "$server_major" ]] || die "startup check: server is PostgreSQL $server_major but this image has pg_dump $client_major; use a newer backup image"
  probe="$BACKUP_ROOT/.write-test-$(hostname)"
  printf 'ok\n' | rclone rcat "$probe" 2>"$BACKUP_STATE_DIR/rclone.err" || die "startup check: cannot write to $BACKUP_DISPLAY: $(head -1 "$BACKUP_STATE_DIR/rclone.err")"
  rclone deletefile "$probe" 2>"$BACKUP_STATE_DIR/rclone.err" || die "startup check: cannot delete in $BACKUP_DISPLAY (retention needs delete): $(head -1 "$BACKUP_STATE_DIR/rclone.err")"
  info "startup check OK: database $(describe_url "$DB_URL") (PostgreSQL $server_major), bucket $BACKUP_DISPLAY writable"
fi

date -u +%s >"$BACKUP_STATE_DIR/started"
info "schedule: '$SCHEDULE' (TZ=${TZ:-UTC}), retention $RETENTION_DAYS days$([[ -n "${BACKUP_VERIFY_SCHEDULE:-}" ]] && printf ', verify %s' "'$BACKUP_VERIFY_SCHEDULE'")"

if is_true "${BACKUP_RUN_ON_START:-false}"; then
  /opt/backup/backup.sh || warn "initial backup failed; the schedule continues"
fi

exec supercronic -passthrough-logs "$CRONTAB"
