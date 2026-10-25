#!/usr/bin/env bash
# walg: the wal-g CLI with this image's checked and normalised settings
# (path-style addressing for custom endpoints, hex libsodium key, region).
# Use it for manual commands, e.g. `walg backup-list --detail`.
source /opt/walg/common.sh
walg_load_config
exec wal-g "$@"
