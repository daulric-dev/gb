#!/usr/bin/env bash
# backup-health: healthy while the last successful backup (or, before the first
# one, the container start) is younger than BACKUP_MAX_AGE_HOURS (default 26).
set -euo pipefail
state="${BACKUP_STATE_DIR:-/run/backup}"
max=$((${BACKUP_MAX_AGE_HOURS:-26} * 3600))
now="$(date -u +%s)"
ref=""
[[ -f "$state/last-success" ]] && ref="$(cat "$state/last-success")"
[[ -z "$ref" && -f "$state/started" ]] && ref="$(cat "$state/started")"
[[ -n "$ref" ]] || { echo "not started"; exit 1; }
age=$((now - ref))
if [[ "$age" -gt "$max" ]]; then
  echo "no successful backup for $((age / 3600))h"
  exit 1
fi
echo "ok: last success/start $((age / 60)) min ago"
