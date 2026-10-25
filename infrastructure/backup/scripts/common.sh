#!/usr/bin/env bash
# Shared helpers for the backup scripts. Sourced, never executed.
#
# Rules every script follows:
#   - never print a connection string, key, password or the healthcheck URL;
#   - fail fast (set -euo pipefail) with a one-line reason;
#   - keep temporary files under BACKUP_WORK_DIR (a tmpfs in compose) and
#     remove them on exit.

set -euo pipefail
umask 077

BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/work}"
BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/run/backup}"
BACKUP_NAME="${BACKUP_NAME:-gradebook}"
# rclone remote name used by every script (configured from env in load_s3_config).
REMOTE="backup"

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" >&2
}
info() { log INFO "$@"; }
warn() { log WARN "$@"; }
die() {
  log ERROR "$@"
  exit 1
}

is_true() {
  case "${1:-}" in
    1 | true | TRUE | True | yes | YES | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

# VAR_FILE support (Docker/Kubernetes secrets): if VAR is empty and VAR_FILE is
# set, read VAR from that file.
file_env() {
  local var="$1" file_var="${1}_FILE"
  local val="${!var:-}" file="${!file_var:-}"
  if [[ -z "$val" && -n "$file" ]]; then
    [[ -r "$file" ]] || die "$file_var points at an unreadable file"
    val="$(<"$file")"
    printf -v "$var" '%s' "$val"
    export "${var?}"
  fi
}

# --- Database URL -----------------------------------------------------------

# Prisma accepts query parameters libpq rejects ("invalid URI query
# parameter"). Drop those; keep everything libpq understands (sslmode, ...).
libpq_url() {
  local url="$1" base query out="" kv key
  if [[ "$url" != *\?* ]]; then
    printf '%s' "$url"
    return
  fi
  base="${url%%\?*}"
  query="${url#*\?}"
  local IFS='&'
  for kv in $query; do
    key="${kv%%=*}"
    case "$key" in
      schema | connection_limit | pool_timeout | pgbouncer | socket_timeout | \
        statement_cache_size | sslaccept | sslidentity | sslpassword | \
        connect_timeout_ms | max_idle_connection_lifetime) continue ;;
    esac
    out="${out:+$out&}$kv"
  done
  printf '%s' "${base}${out:+?$out}"
}

# "host:port/db" for logs: never the user or password.
describe_url() {
  local rest="${1#*://}"
  rest="${rest##*@}"
  rest="${rest%%\?*}"
  printf '%s' "$rest"
}

# Replace the database name in a postgres URL.
url_with_db() {
  local url="$1" db="$2"
  if [[ "$url" =~ ^(postgres(ql)?://[^/?]*)(/[^?]*)?(\?.*)?$ ]]; then
    printf '%s/%s%s' "${BASH_REMATCH[1]}" "$db" "${BASH_REMATCH[4]}"
  else
    die "cannot parse database URL (expected postgresql://user:pass@host:port/db)"
  fi
}

load_db_config() {
  file_env BACKUP_DATABASE_URL
  file_env DATABASE_URL
  local url="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
  [[ -n "$url" ]] || die "BACKUP_DATABASE_URL (or DATABASE_URL) is not set"
  [[ "$url" =~ ^postgres(ql)?:// ]] || die "BACKUP_DATABASE_URL must be a postgresql:// URL"
  DB_URL="$(libpq_url "$url")"
}

# --- Object storage (rclone, configured only through the environment) ------

load_s3_config() {
  file_env BACKUP_S3_ACCESS_KEY_ID
  file_env BACKUP_S3_SECRET_ACCESS_KEY

  [[ -n "${BACKUP_S3_BUCKET:-}" ]] || die "BACKUP_S3_BUCKET is not set"
  [[ "$BACKUP_S3_BUCKET" != */* ]] || die "BACKUP_S3_BUCKET is a bucket name, not a path (use BACKUP_S3_PREFIX)"

  local prefix="${BACKUP_S3_PREFIX-postgres}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  BACKUP_ROOT="${REMOTE}:${BACKUP_S3_BUCKET}${prefix:+/$prefix}"
  # For logs: s3://bucket/prefix (no endpoint, no credentials).
  BACKUP_DISPLAY="s3://${BACKUP_S3_BUCKET}${prefix:+/$prefix}"

  export RCLONE_CONFIG=/dev/null
  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_REGION="${BACKUP_S3_REGION:-us-east-1}"
  # Least privilege: never list or create buckets; the bucket must exist.
  # (BACKUP_S3_NO_CHECK_BUCKET=false lets `backup-rclone mkdir` create one.)
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET="${BACKUP_S3_NO_CHECK_BUCKET:-true}"
  if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
    export RCLONE_CONFIG_BACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
    export RCLONE_CONFIG_BACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
    export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-true}"
  else
    export RCLONE_CONFIG_BACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-AWS}"
    export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-false}"
  fi
  if [[ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ]]; then
    [[ -n "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]] || die "BACKUP_S3_SECRET_ACCESS_KEY is not set"
    export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
    export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  else
    # Instance role / web identity / AWS_* variables.
    export RCLONE_CONFIG_BACKUP_ENV_AUTH=true
  fi
  if [[ -n "${BACKUP_S3_STORAGE_CLASS:-}" ]]; then
    export RCLONE_CONFIG_BACKUP_STORAGE_CLASS="$BACKUP_S3_STORAGE_CLASS"
  fi
  # Quiet, non-interactive, retrying.
  export RCLONE_LOG_LEVEL="${RCLONE_LOG_LEVEL:-ERROR}"
  export RCLONE_RETRIES="${RCLONE_RETRIES:-5}"
  export RCLONE_LOW_LEVEL_RETRIES="${RCLONE_LOW_LEVEL_RETRIES:-10}"
  export RCLONE_ASK_PASSWORD=false
  export RCLONE_STATS=0
}

# --- Encryption -------------------------------------------------------------

# Sets ENCRYPT=1 and RECIPIENTS_FILE, or ENCRYPT=0 when explicitly allowed.
load_encryption_config() {
  file_env BACKUP_AGE_RECIPIENTS
  local recipients="${BACKUP_AGE_RECIPIENTS:-}"
  if [[ -z "$recipients" && -z "${BACKUP_AGE_RECIPIENTS_FILE:-}" ]]; then
    if is_true "${BACKUP_ALLOW_UNENCRYPTED:-false}"; then
      warn "BACKUP_ALLOW_UNENCRYPTED=true: this backup is NOT encrypted. Development only."
      ENCRYPT=0
      return
    fi
    die "BACKUP_AGE_RECIPIENTS is not set: refusing to make an unencrypted backup. Generate a key pair with age-keygen (keep the private key OFF this server) and set the public key (age1...)."
  fi
  if is_true "${BACKUP_ALLOW_UNENCRYPTED:-false}"; then
    warn "BACKUP_ALLOW_UNENCRYPTED is ignored because recipients are configured"
  fi

  mkdir -p "$BACKUP_STATE_DIR"
  RECIPIENTS_FILE="$BACKUP_STATE_DIR/recipients.txt"
  : >"$RECIPIENTS_FILE"
  local r count=0
  # Comma or newline separated (SSH keys contain a space).
  while IFS= read -r r; do
    r="$(printf '%s' "$r" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -n "$r" ]] || continue
    case "$r" in
      age1* | ssh-ed25519\ * | ssh-rsa\ *) printf '%s\n' "$r" >>"$RECIPIENTS_FILE" ;;
      AGE-SECRET-KEY-*) die "BACKUP_AGE_RECIPIENTS contains a PRIVATE key. Put only the public key (age1...) here and remove the private key from this server." ;;
      *) die "BACKUP_AGE_RECIPIENTS has an entry that is not an age (age1...) or SSH public key" ;;
    esac
  done < <(printf '%s\n' "$recipients" | tr ',' '\n')
  if [[ -n "${BACKUP_AGE_RECIPIENTS_FILE:-}" ]]; then
    [[ -r "$BACKUP_AGE_RECIPIENTS_FILE" ]] || die "BACKUP_AGE_RECIPIENTS_FILE is not readable"
    grep -q 'AGE-SECRET-KEY-' "$BACKUP_AGE_RECIPIENTS_FILE" && die "BACKUP_AGE_RECIPIENTS_FILE contains a PRIVATE key"
    cat "$BACKUP_AGE_RECIPIENTS_FILE" >>"$RECIPIENTS_FILE"
  fi
  count="$(grep -cv '^[[:space:]]*\(#\|$\)' "$RECIPIENTS_FILE" || true)"
  [[ "$count" -gt 0 ]] || die "no age recipients found"
  # Prove the recipients parse before dumping anything.
  printf 'probe' | age -R "$RECIPIENTS_FILE" >/dev/null 2>&1 || die "BACKUP_AGE_RECIPIENTS is not a valid list of age/SSH public keys"
  ENCRYPT=1
  RECIPIENT_COUNT="$count"
}

# --- Healthchecks.io-style pings ---------------------------------------------

# hc_ping <url-var> <suffix: "/start" | "" | "/fail"> [message]
hc_ping() {
  local url="${!1:-}" suffix="$2" msg="${3:-}"
  [[ -n "$url" ]] || return 0
  url="${url%/}"
  if ! curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${msg:0:10000}" "${url}${suffix}" 2>/dev/null; then
    warn "healthcheck ping ${suffix:-/success} failed (the backup result is unaffected)"
  fi
}

# --- Locking ----------------------------------------------------------------

# One run at a time per container (cron and a manual backup-now).
acquire_lock() {
  local name="$1"
  mkdir -p "$BACKUP_STATE_DIR"
  exec 9>"$BACKUP_STATE_DIR/$name.lock"
  if ! flock -n 9; then
    log ERROR "another $name run is in progress; not starting a second one"
    exit 75
  fi
}

# --- Object names -----------------------------------------------------------

# gradebook-20261025T040000Z.dump.age -> 20261025T040000Z
timestamp_of() {
  local base="${1##*/}"
  if [[ "$base" =~ -([0-9]{8}T[0-9]{6}Z)\.dump ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Newest complete backup key (relative to BACKUP_ROOT): a dump whose .sha256
# sidecar exists. Empty when there is none.
latest_backup_key() {
  local listing
  listing="$(rclone lsf -R --files-only "$BACKUP_ROOT/daily")" || die "cannot list $BACKUP_S3_BUCKET (check BACKUP_S3_* settings and permissions)"
  printf '%s\n' "$listing" | grep -E "/${BACKUP_NAME}-[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$" |
    while read -r key; do
      if printf '%s\n' "$listing" | grep -qxF "${key}.sha256"; then
        printf '%s\t%s\n' "$(timestamp_of "$key")" "daily/$key"
      fi
    done | sort | tail -n 1 | cut -f2
}
