#!/usr/bin/env bash
# walg-basebackup: one full base backup (wal-g backup-push), then retention:
# keep the newest WALG_RETAIN_FULL (default 7) full backups and the WAL needed
# to replay from the oldest of them - the point-in-time window.
#
# Runs where the data directory is readable (the sidecar mounts the db volume
# read-only) and Postgres is reachable through PGHOST/PGUSER/PGPASSWORD.
source /opt/walg/common.sh
walg_load_config
: "${PGDATA:?PGDATA is not set}"
[[ -r "$PGDATA/PG_VERSION" ]] || die "cannot read $PGDATA/PG_VERSION: mount the database volume (read-only is enough) and run as the postgres user"

acquire_lock basebackup
STAGE="start"
on_exit() {
  local rc=$?
  if [[ $rc -ne 0 && $rc -ne 75 ]]; then
    log ERROR "base backup FAILED during '$STAGE' (exit $rc)"
    hc_ping /fail "base backup failed during '$STAGE' (exit $rc)"
  fi
}
trap on_exit EXIT

hc_ping /start
START="$(date -u +%s)"
STAGE="backup-push"
info "base backup started -> ${WALG_S3_PREFIX}"
wal-g backup-push "$PGDATA"

STAGE="retention"
wal-g delete retain FULL "$WALG_RETAIN_FULL" --confirm
COUNT="$(wal-g backup-list --json 2>/dev/null | jq 'length')"
OLDEST="$(wal-g backup-list --json 2>/dev/null | jq -r 'min_by(.time) | .time')"

STAGE="done"
mkdir -p "$WALG_STATE_DIR"
date -u +%s >"$WALG_STATE_DIR/last-success"
info "base backup OK in $(($(date -u +%s) - START))s; $COUNT full backup(s) kept, point-in-time window starts $OLDEST"
hc_ping "" "ok backups=$COUNT oldest=$OLDEST"
