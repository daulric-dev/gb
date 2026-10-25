#!/usr/bin/env bash
# walg-health (sidecar): unhealthy when the last base backup (or the sidecar
# start, before the first one) is older than WALG_MAX_AGE_HOURS (default 26),
# or when the server's WAL archiver is currently failing.
set -euo pipefail
state="${WALG_STATE_DIR:-/run/walg}"
max=$((${WALG_MAX_AGE_HOURS:-26} * 3600))
now="$(date -u +%s)"
ref=""
[[ -f "$state/last-success" ]] && ref="$(cat "$state/last-success")"
[[ -z "$ref" && -f "$state/started" ]] && ref="$(cat "$state/started")"
[[ -n "$ref" ]] || { echo "not started"; exit 1; }
if (( now - ref > max )); then
  echo "no successful base backup for $(((now - ref) / 3600))h"
  exit 1
fi
failing="$(psql -XAtqc "select coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false) from pg_stat_archiver" 2>/dev/null || echo unknown)"
case "$failing" in
  f) echo "ok: base backup/start $(((now - ref) / 60)) min ago, archiver healthy" ;;
  t) echo "WAL archiving is failing (see pg_stat_archiver and the db logs)"; exit 1 ;;
  *) echo "cannot query pg_stat_archiver"; exit 1 ;;
esac
