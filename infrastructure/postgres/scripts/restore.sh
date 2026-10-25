#!/usr/bin/env bash
# walg-restore: prepare an EMPTY data directory for point-in-time recovery.
#
# Usage (db stopped, a NEW/empty volume mounted at /var/lib/postgresql):
#   walg-restore --target-time 2026-10-25T13:59:00Z
#   walg-restore                      # replay all archived WAL (latest state)
#   walg-restore --backup base_000000010000000000000004 [--target-time ...]
#
#   --target-time   UTC, YYYY-MM-DDTHH:MM:SSZ. Recovery stops just before the
#                   first transaction that committed after this instant. The
#                   newest base backup that finished before it is chosen.
#   --backup        a name from `wal-g backup-list` (or LATEST)
#   --target-action promote (default) | pause | shutdown
#
# Afterwards start the database normally (the image's default command):
# Postgres fetches WAL through restore_command, stops at the target, promotes
# to a new timeline and keeps archiving. Then take a fresh base backup
# (walg-basebackup) and check the data before pointing the API at it.
source /opt/walg/common.sh

: "${PGDATA:?PGDATA is not set}"
if [[ "$(id -u)" == 0 ]]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA" "$(dirname "$PGDATA")"
  chmod 0700 "$PGDATA"
  mkdir -p "$WALG_STATE_DIR" && chown postgres:postgres "$WALG_STATE_DIR"
  exec gosu postgres "$0" "$@"
fi

TARGET_TIME=""
BACKUP=""
ACTION="promote"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-time) TARGET_TIME="${2:?}"; shift 2 ;;
    --backup) BACKUP="${2:?}"; shift 2 ;;
    --target-action) ACTION="${2:?}"; shift 2 ;;
    -h | --help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$ACTION" =~ ^(promote|pause|shutdown)$ ]] || die "--target-action must be promote, pause or shutdown"
if [[ -n "$TARGET_TIME" ]]; then
  [[ "$TARGET_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    die "--target-time must be UTC like 2026-10-25T13:59:00Z"
fi

PG_TARGET_TIME=""
if [[ -n "$TARGET_TIME" ]]; then
  PG_TARGET_TIME="${TARGET_TIME/T/ }"
  PG_TARGET_TIME="${PG_TARGET_TIME%Z}+00"
fi

walg_load_config
mkdir -p "$PGDATA"
if [[ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]]; then
  die "$PGDATA is not empty. Restore into a NEW volume (keep the old one until the restore is verified)."
fi

# Pick the base backup.
LIST="$(wal-g backup-list --json --detail)" || die "cannot list base backups in $WALG_S3_PREFIX"
[[ "$(jq 'length' <<<"$LIST")" -gt 0 ]] || die "no base backups in $WALG_S3_PREFIX"
if [[ -z "$BACKUP" ]]; then
  if [[ -n "$TARGET_TIME" ]]; then
    BACKUP="$(jq -r --arg t "$TARGET_TIME" '
      map(select((.finish_time | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601) <= ($t | fromdateiso8601)))
      | sort_by(.finish_time) | last | .backup_name // empty' <<<"$LIST")"
    [[ -n "$BACKUP" ]] || die "no base backup finished before $TARGET_TIME; the oldest finished at $(jq -r 'min_by(.finish_time) | .finish_time' <<<"$LIST")"
  else
    BACKUP="LATEST"
  fi
fi
info "fetching base backup $BACKUP into $PGDATA"
wal-g backup-fetch "$PGDATA" "$BACKUP"

touch "$PGDATA/recovery.signal"
{
  echo ""
  echo "# --- added by walg-restore $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
  echo "restore_command = 'wal-g wal-fetch %f %p'"
  # Postgres wants "YYYY-MM-DD HH:MM:SS+00" here, not the ISO "T...Z" form.
  [[ -n "$TARGET_TIME" ]] && echo "recovery_target_time = '${PG_TARGET_TIME}'"
  echo "recovery_target_action = '$ACTION'"
} >>"$PGDATA/postgresql.auto.conf"

info "ready: base backup $BACKUP restored, recovery.signal written$([[ -n "$TARGET_TIME" ]] && printf ', target %s' "$TARGET_TIME")"
info "next: start the db service normally; watch its log for 'recovery stopping before' / 'database system is ready to accept connections'"
info "then: remove the recovery_target_* lines from postgresql.auto.conf, run walg-basebackup, verify the data, and point DATABASE_URL at it"
