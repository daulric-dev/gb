#!/usr/bin/env bash
# backup-list: list backups (size, date, key relative to BACKUP_S3_PREFIX).
source /opt/backup/common.sh
load_s3_config
rclone lsl "$BACKUP_ROOT/daily" | sort -k4 | sed 's#\([^ ]*\)$#daily/\1#'
