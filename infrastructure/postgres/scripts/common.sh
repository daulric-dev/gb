#!/usr/bin/env bash
# Shared helpers for the WAL-G scripts. Sourced, never executed.
#
# Configuration (container environment; WAL-G reads these names itself):
#   WALG_S3_PREFIX            s3://<bucket>/<path>, e.g. s3://gradebook-backups/wal-g
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
#   AWS_ENDPOINT              non-AWS providers (R2, B2, MinIO, SeaweedFS ...)
#   AWS_S3_FORCE_PATH_STYLE   default true when AWS_ENDPOINT is set
#   WALG_LIBSODIUM_KEY        64 hex chars (openssl rand -hex 32), or
#   WALG_LIBSODIUM_KEY_PATH   a file holding it
#   WALG_ALLOW_UNENCRYPTED    true = allow no encryption (development only)
#   WALG_ENABLED              false = plain postgres, no archiving (loud warning)

set -euo pipefail
umask 077

WALG_STATE_DIR="${WALG_STATE_DIR:-/run/walg}"

log() {
  local level="$1"
  shift
  printf '%s [walg %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" >&2
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

walg_enabled() { ! [[ "${WALG_ENABLED:-true}" =~ ^(false|FALSE|0|no|off)$ ]]; }

# Validate and normalise the WAL-G environment; die with a clear reason.
walg_load_config() {
  # Compose passes unset settings as empty strings; WAL-G must not see those.
  local v
  for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT AWS_S3_FORCE_PATH_STYLE AWS_REGION \
    WALG_LIBSODIUM_KEY WALG_LIBSODIUM_KEY_PATH WALG_PGP_KEY WALG_PGP_KEY_PATH; do
    [[ -n "${!v:-}" ]] || unset "$v"
  done

  [[ -n "${WALG_S3_PREFIX:-}" ]] || die "WALG_S3_PREFIX is not set (e.g. s3://gradebook-backups/wal-g). Set it, or WALG_ENABLED=false to run without continuous backup."
  [[ "$WALG_S3_PREFIX" =~ ^s3://[^/]+ ]] || die "WALG_S3_PREFIX must look like s3://<bucket>/<path>"

  if [[ -n "${AWS_ACCESS_KEY_ID:-}" || -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || die "set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for WAL-G"
  fi
  export AWS_REGION="${AWS_REGION:-us-east-1}"
  if [[ -n "${AWS_ENDPOINT:-}" ]]; then
    export AWS_S3_FORCE_PATH_STYLE="${AWS_S3_FORCE_PATH_STYLE:-true}"
  else
    unset AWS_ENDPOINT
  fi

  if [[ -n "${WALG_LIBSODIUM_KEY:-}" ]]; then
    if [[ -z "${WALG_LIBSODIUM_KEY_TRANSFORM:-}" ]]; then
      [[ "$WALG_LIBSODIUM_KEY" =~ ^[0-9a-fA-F]{64}$ ]] || die "WALG_LIBSODIUM_KEY must be 64 hex characters (openssl rand -hex 32)"
      export WALG_LIBSODIUM_KEY_TRANSFORM=hex
    fi
  elif [[ -n "${WALG_LIBSODIUM_KEY_PATH:-}" ]]; then
    [[ -r "$WALG_LIBSODIUM_KEY_PATH" ]] || die "WALG_LIBSODIUM_KEY_PATH is not readable"
    if [[ -z "${WALG_LIBSODIUM_KEY_TRANSFORM:-}" ]] && grep -Eqx '[0-9a-fA-F]{64}' "$WALG_LIBSODIUM_KEY_PATH"; then
      export WALG_LIBSODIUM_KEY_TRANSFORM=hex
    fi
  elif [[ -n "${WALG_PGP_KEY:-}${WALG_PGP_KEY_PATH:-}" ]]; then
    : # WAL-G's own PGP support
  elif is_true "${WALG_ALLOW_UNENCRYPTED:-false}"; then
    warn "WALG_ALLOW_UNENCRYPTED=true: WAL and base backups are NOT encrypted. Development only."
  else
    die "no WAL-G encryption key: set WALG_LIBSODIUM_KEY (openssl rand -hex 32) or WALG_LIBSODIUM_KEY_PATH. Refusing to archive unencrypted."
  fi

  local retain="${WALG_RETAIN_FULL:-7}"
  [[ "$retain" =~ ^[0-9]+$ && "$retain" -ge 1 ]] || die "WALG_RETAIN_FULL must be a whole number >= 1"
  export WALG_RETAIN_FULL="$retain"
}

hc_ping() {
  local url="${WALG_HEALTHCHECK_URL:-}" suffix="$1" msg="${2:-}"
  [[ -n "$url" ]] || return 0
  url="${url%/}"
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${msg:0:10000}" "${url}${suffix}" 2>/dev/null ||
    warn "healthcheck ping ${suffix:-/success} failed"
}

acquire_lock() {
  mkdir -p "$WALG_STATE_DIR"
  exec 9>"$WALG_STATE_DIR/$1.lock"
  flock -n 9 || {
    log ERROR "another $1 run is in progress"
    exit 75
  }
}
