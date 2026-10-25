#!/usr/bin/env bash
# walg-cron: base-backup scheduler, run as a sidecar next to `db` with the same
# volume mounted read-only, as the postgres user.
#
#   WALG_BACKUP_SCHEDULE  default "0 4 * * *" (04:00 in TZ, default UTC)
#   WALG_RETAIN_FULL      default 7 full backups (about 7 days of PITR)
#
# On start it checks the configuration, waits for Postgres, checks that the
# server really archives WAL, and takes a first base backup if none exists
# (archived WAL is useless without one).
source /opt/walg/common.sh
walg_load_config
: "${PGDATA:?PGDATA is not set}"

SCHEDULE="${WALG_BACKUP_SCHEDULE:-0 4 * * *}"
mkdir -p "$WALG_STATE_DIR"
CRONTAB="$WALG_STATE_DIR/crontab"
printf '%s /opt/walg/basebackup.sh\n' "$SCHEDULE" >"$CRONTAB"
supercronic -test "$CRONTAB" >/dev/null 2>&1 || die "invalid WALG_BACKUP_SCHEDULE: $SCHEDULE"

info "waiting for postgres at ${PGHOST:-local socket}"
for _ in $(seq 1 120); do
  pg_isready -q && break
  sleep 2
done
pg_isready -q || die "postgres is not reachable (PGHOST/PGPORT/PGUSER/PGPASSWORD)"
for _ in $(seq 1 30); do [[ -r "$PGDATA/PG_VERSION" ]] && break; sleep 2; done
[[ -r "$PGDATA/PG_VERSION" ]] || die "cannot read $PGDATA: mount the db volume and run as the postgres user"

mode="$(psql -XAtqc 'show archive_mode')"
cmd="$(psql -XAtqc 'show archive_command')"
[[ "$mode" == "on" && "$cmd" == wal-g* ]] || die "the server is not archiving through WAL-G (archive_mode=$mode): run db from infrastructure/postgres with WALG_* set"

date -u +%s >"$WALG_STATE_DIR/started"
if ! wal-g backup-list --json 2>/dev/null | jq -e 'length > 0' >/dev/null 2>&1; then
  info "no base backup exists yet: taking the first one now"
  /opt/walg/basebackup.sh || warn "first base backup failed; the schedule continues"
fi

info "base backups scheduled '$SCHEDULE' (TZ=${TZ:-UTC}), keeping $WALG_RETAIN_FULL full backups"
exec supercronic -passthrough-logs "$CRONTAB"
