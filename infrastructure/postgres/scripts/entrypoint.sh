#!/usr/bin/env bash
# walg-entrypoint: the official postgres entrypoint, plus continuous WAL
# archiving through WAL-G when the server starts.
#
#   wal_level=replica, archive_mode=on, archive_command='wal-g wal-push %p',
#   archive_timeout=${WALG_ARCHIVE_TIMEOUT:-60}, restore_command='wal-g wal-fetch %f %p'
#
# archive_timeout bounds data loss (RPO) on an idle-ish server: a WAL segment
# is shipped at least every N seconds when anything was written. restore_command
# is only used during recovery (recovery.signal / standby.signal), so setting it
# always is harmless and makes a point-in-time restore a two-step job.
# Any other command (walg-cron, wal-g, psql ...) runs as given.
source /opt/walg/common.sh

if [[ "${1:-}" == "postgres" || "${1:-}" == -* ]]; then
  [[ "${1:-}" == "postgres" ]] || set -- postgres "$@"
  if walg_enabled; then
    walg_load_config
    timeout="${WALG_ARCHIVE_TIMEOUT:-60}"
    [[ "$timeout" =~ ^[0-9]+$ ]] || die "WALG_ARCHIVE_TIMEOUT must be seconds"
    set -- "$@" \
      -c wal_level=replica \
      -c archive_mode=on \
      -c "archive_command=wal-g wal-push %p" \
      -c "archive_timeout=${timeout}" \
      -c "restore_command=wal-g wal-fetch %f %p"
    info "continuous archiving ON: WAL -> ${WALG_S3_PREFIX} (archive_timeout=${timeout}s)"
  else
    warn "WALG_ENABLED=false: continuous WAL archiving is OFF; point-in-time recovery is impossible"
  fi
fi

# common.sh tightens the umask; give the official entrypoint its usual one.
umask 0022
exec docker-entrypoint.sh "$@"
