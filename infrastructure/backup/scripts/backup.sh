#!/usr/bin/env bash
# backup-now: dump -> encrypt -> upload -> verify upload -> prune old backups.
#
#   <bucket>/<prefix>/daily/YYYY/MM/<name>-<UTC timestamp>.dump.age
#   <bucket>/<prefix>/daily/YYYY/MM/<name>-<UTC timestamp>.dump.age.sha256
#
# The plaintext dump never touches disk: pg_dump streams straight into age, and
# only ciphertext is written to BACKUP_WORK_DIR before upload. Retention runs
# only after the new backup is uploaded and its size checked.
source /opt/backup/common.sh

load_db_config
load_s3_config
load_encryption_config

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || die "BACKUP_RETENTION_DAYS must be a whole number of days >= 1"

acquire_lock backup

STARTED_AT="$(date -u +%s)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
EXT=".dump"
[[ "$ENCRYPT" == 1 ]] && EXT=".dump.age"
FILE_NAME="${BACKUP_NAME}-${TS}${EXT}"
KEY="daily/${TS:0:4}/${TS:4:2}/${FILE_NAME}"
REMOTE_OBJ="$BACKUP_ROOT/$KEY"

mkdir -p "$BACKUP_WORK_DIR"
TMP="$(mktemp -d "$BACKUP_WORK_DIR/backup.XXXXXX")"
LOCAL_FILE="$TMP/$FILE_NAME"
UPLOADED=0
STAGE="start"

on_exit() {
  local rc=$?
  rm -rf "$TMP"
  if [[ $rc -ne 0 && $rc -ne 75 ]]; then
    # Never leave a half-uploaded backup that looks complete.
    if [[ "$UPLOADED" == 1 && "$STAGE" != "prune" ]]; then
      rclone deletefile "$REMOTE_OBJ" >/dev/null 2>&1 || true
      rclone deletefile "$REMOTE_OBJ.sha256" >/dev/null 2>&1 || true
    fi
    log ERROR "backup FAILED during '$STAGE' (exit $rc)"
    hc_ping BACKUP_HEALTHCHECK_URL /fail "backup failed during '$STAGE' (exit $rc)"
  fi
}
trap on_exit EXIT

hc_ping BACKUP_HEALTHCHECK_URL /start
info "backup started: database $(describe_url "$DB_URL") -> $BACKUP_DISPLAY/$KEY"
if [[ "$ENCRYPT" == 1 ]]; then
  info "encrypting with age to $RECIPIENT_COUNT recipient(s)"
fi

STAGE="connect"
SERVER_VERSION="$(psql "$DB_URL" -XAtqc 'show server_version' 2>&1)" || die "cannot connect to the database: $(printf '%s' "$SERVER_VERSION" | head -1)"
info "server PostgreSQL $SERVER_VERSION, client $(pg_dump --version | awk '{print $3}')"

STAGE="dump"
if [[ "$ENCRYPT" == 1 ]]; then
  pg_dump --dbname="$DB_URL" --format=custom --no-password --quote-all-identifiers |
    age --encrypt -R "$RECIPIENTS_FILE" -o "$LOCAL_FILE"
else
  pg_dump --dbname="$DB_URL" --format=custom --no-password --quote-all-identifiers -f "$LOCAL_FILE"
fi
SIZE="$(stat -c %s "$LOCAL_FILE")"
[[ "$SIZE" -gt 0 ]] || die "the dump is empty"

STAGE="checksum"
(cd "$TMP" && sha256sum "$FILE_NAME" >"$FILE_NAME.sha256")
SHA="$(cut -d' ' -f1 "$TMP/$FILE_NAME.sha256")"

STAGE="upload"
UPLOADED=1
rclone copyto "$LOCAL_FILE" "$REMOTE_OBJ"
REMOTE_SIZE="$(rclone lsjson --stat "$REMOTE_OBJ" | jq -r '.Size')"
[[ "$REMOTE_SIZE" == "$SIZE" ]] || die "uploaded object size $REMOTE_SIZE != local size $SIZE"
# The .sha256 goes last: its presence marks the backup as complete.
rclone copyto "$TMP/$FILE_NAME.sha256" "$REMOTE_OBJ.sha256"
info "uploaded $FILE_NAME ($SIZE bytes, sha256 $SHA)"

STAGE="prune"
CUTOFF="$(date -u -d "@$((STARTED_AT - RETENTION_DAYS * 86400))" +%Y%m%dT%H%M%SZ)"
DELETED=0
LISTING="$(rclone lsf -R --files-only "$BACKUP_ROOT/daily")"
while IFS= read -r obj; do
  [[ -n "$obj" ]] || continue
  ts="$(timestamp_of "$obj")"
  # Only touch objects this tool named; skip anything else in the prefix.
  [[ -n "$ts" && "${obj##*/}" == "${BACKUP_NAME}-"* ]] || continue
  [[ "daily/$obj" != "$KEY" && "daily/$obj" != "$KEY.sha256" ]] || continue
  if [[ "$ts" < "$CUTOFF" ]]; then
    rclone deletefile "$BACKUP_ROOT/daily/$obj"
    info "retention: deleted daily/$obj (older than $RETENTION_DAYS days)"
    DELETED=$((DELETED + 1))
  fi
done <<<"$LISTING"
info "retention: kept backups newer than $CUTOFF, deleted $DELETED object(s)"

STAGE="done"
mkdir -p "$BACKUP_STATE_DIR"
date -u +%s >"$BACKUP_STATE_DIR/last-success"
DURATION=$(($(date -u +%s) - STARTED_AT))
info "backup OK in ${DURATION}s: $KEY"
hc_ping BACKUP_HEALTHCHECK_URL "" "ok $KEY size=$SIZE sha256=$SHA duration=${DURATION}s pruned=$DELETED"
