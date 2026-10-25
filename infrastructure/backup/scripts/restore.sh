#!/usr/bin/env bash
# backup-restore: download a backup, verify its sha256, decrypt it with the age
# private key supplied now (never stored on the server), and pg_restore it.
#
# Usage:
#   backup-restore --target <postgresql://...> [--latest | --key daily/YYYY/MM/<file> | --file <local file>]
#                  [--identity <age identity file>] [--force] [--keep-owner]
#
#   --target      database to restore into (or RESTORE_DATABASE_URL). It must
#                 already exist (CREATE DATABASE ...) and, without --force, be
#                 empty.
#   --latest      newest complete backup in the bucket (default)
#   --key         a key relative to BACKUP_S3_PREFIX, as shown by backup-list
#   --file        a local, already downloaded backup (its .sha256 next to it is
#                 checked when present)
#   --identity    age identity (private key) file, or BACKUP_AGE_IDENTITY_FILE.
#                 Mount it read-only for this one command; do not leave it on
#                 the server.
#   --force       restore into a non-empty database: objects in the dump are
#                 dropped and recreated (pg_restore --clean --if-exists)
#   --keep-owner  keep the original owners and grants (default: everything is
#                 owned by the --target user, which is what a new database
#                 or a different provider needs)
#
# The restore runs in a single transaction: it either fully succeeds or leaves
# the target unchanged.
source /opt/backup/common.sh

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

TARGET="${RESTORE_DATABASE_URL:-}"
KEY=""
LOCAL=""
IDENTITY="${BACKUP_AGE_IDENTITY_FILE:-}"
FORCE=0
KEEP_OWNER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?--target needs a URL}"; shift 2 ;;
    --latest) KEY=""; shift ;;
    --key) KEY="${2:?--key needs an object key}"; shift 2 ;;
    --file) LOCAL="${2:?--file needs a path}"; shift 2 ;;
    --identity) IDENTITY="${2:?--identity needs a file}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --keep-owner) KEEP_OWNER=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[[ -n "$TARGET" ]] || die "--target (or RESTORE_DATABASE_URL) is required"
[[ "$TARGET" =~ ^postgres(ql)?:// ]] || die "--target must be a postgresql:// URL"
TARGET="$(libpq_url "$TARGET")"

mkdir -p "$BACKUP_WORK_DIR"
TMP="$(mktemp -d "$BACKUP_WORK_DIR/restore.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# 1. Get the backup and its checksum.
if [[ -n "$LOCAL" ]]; then
  [[ -r "$LOCAL" ]] || die "cannot read $LOCAL"
  FILE="$TMP/$(basename "$LOCAL")"
  cp "$LOCAL" "$FILE"
  if [[ -r "$LOCAL.sha256" ]]; then
    cp "$LOCAL.sha256" "$FILE.sha256"
  else
    warn "no $LOCAL.sha256 next to the file: integrity is checked by decryption only"
  fi
else
  load_s3_config
  if [[ -z "$KEY" ]]; then
    KEY="$(latest_backup_key)"
    [[ -n "$KEY" ]] || die "no complete backup found under $BACKUP_DISPLAY/daily"
  fi
  KEY="${KEY#/}"
  info "downloading $BACKUP_DISPLAY/$KEY"
  FILE="$TMP/$(basename "$KEY")"
  rclone copyto "$BACKUP_ROOT/$KEY" "$FILE" || die "download failed: $KEY"
  rclone copyto "$BACKUP_ROOT/$KEY.sha256" "$FILE.sha256" || die "download failed: $KEY.sha256 (incomplete backup?)"
fi

# 2. Verify the checksum of the encrypted file.
if [[ -f "$FILE.sha256" ]]; then
  expected="$(awk '{print $1; exit}' "$FILE.sha256")"
  actual="$(sha256sum "$FILE" | cut -d' ' -f1)"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "malformed .sha256 file"
  [[ "$expected" == "$actual" ]] || die "sha256 mismatch: the backup is corrupt or was modified (expected $expected, got $actual)"
  info "sha256 OK ($actual)"
fi

ENCRYPTED=0
[[ "$FILE" == *.age ]] && ENCRYPTED=1
if [[ "$ENCRYPTED" == 1 ]]; then
  [[ -n "$IDENTITY" ]] || die "this backup is encrypted: pass --identity <file> (the age private key)"
  [[ -r "$IDENTITY" ]] || die "cannot read the identity file"
  # Fail before touching the database when the key is wrong.
  age --decrypt -i "$IDENTITY" "$FILE" 2>"$TMP/age.err" | head -c 5 >"$TMP/magic" || true
  if [[ "$(cat "$TMP/magic")" != "PGDMP" ]]; then
    die "cannot decrypt with this identity: $(head -1 "$TMP/age.err")"
  fi
fi

# 3. Check the target.
psql "$TARGET" -XAtqc 'select 1' >/dev/null 2>"$TMP/psql.err" || die "cannot connect to the target: $(head -1 "$TMP/psql.err")"
OBJECTS="$(psql "$TARGET" -XAtqc "
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')")"
CLEAN_ARGS=()
if [[ "$OBJECTS" -gt 0 ]]; then
  if [[ "$FORCE" != 1 ]]; then
    die "the target database $(describe_url "$TARGET") is not empty ($OBJECTS tables/views/sequences). Restore into a new empty database, or pass --force to drop and recreate the dumped objects."
  fi
  warn "--force: dropping and recreating dumped objects in $(describe_url "$TARGET")"
  CLEAN_ARGS=(--clean --if-exists)
fi
OWNER_ARGS=(--no-owner --no-privileges)
[[ "$KEEP_OWNER" == 1 ]] && OWNER_ARGS=()

# 4. Restore (plaintext only ever flows through the pipe).
info "restoring $(basename "$FILE") into $(describe_url "$TARGET")"
START="$(date -u +%s)"
if [[ "$ENCRYPTED" == 1 ]]; then
  age --decrypt -i "$IDENTITY" "$FILE" |
    pg_restore --dbname="$TARGET" --no-password --exit-on-error --single-transaction "${OWNER_ARGS[@]}" "${CLEAN_ARGS[@]}"
else
  pg_restore --dbname="$TARGET" --no-password --exit-on-error --single-transaction "${OWNER_ARGS[@]}" "${CLEAN_ARGS[@]}" "$FILE"
fi
info "restore OK in $(($(date -u +%s) - START))s"
