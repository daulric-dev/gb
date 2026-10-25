#!/usr/bin/env bash
# backup-rclone: rclone with the backup bucket configured as remote "backup:".
#   backup-rclone lsf backup:<bucket>/<prefix>/daily -R
source /opt/backup/common.sh
load_s3_config
exec rclone "$@"
