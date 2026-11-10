#!/usr/bin/env bash
# Deploys GradeBook with PM2 on a server: install, build, migrate, reload. See infrastructure/pm2/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ECOSYSTEM="${SCRIPT_DIR}/ecosystem.config.cjs"
# Word-split on purpose so PM2="bunx pm2" works.
read -r -a PM2_CMD <<< "${PM2:-pm2}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'deploy.sh: %s\n' "$*" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------

command -v bun > /dev/null || die "bun is not installed (need Bun 1.4.4, see package.json packageManager)."
command -v node > /dev/null || die "node is not installed (Next.js needs Node >= 20.9)."
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  process.exit(maj > 20 || (maj === 20 && min >= 9) ? 0 : 1);
' || die "Node $(node --version) is too old: Next.js needs Node >= 20.9."
command -v "${PM2_CMD[0]}" > /dev/null \
  || die "${PM2_CMD[0]} not found: run infrastructure/pm2/setup.sh first (or set PM2=...)."

[ -f "${REPO_ROOT}/backend/.env" ] \
  || die "backend/.env is missing: copy backend/.env.example and fill in production values (README.md)."

# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time. Same
# lookup order as `next build`: environment, then .env.production.local,
# .env.local, .env.production, .env in frontend/.
next_public_api_url_source() {
  if [ -n "${NEXT_PUBLIC_API_URL:-}" ]; then
    printf 'environment\t%s\n' "${NEXT_PUBLIC_API_URL}"
    return 0
  fi
  local file value
  for file in .env.production.local .env.local .env.production .env; do
    [ -f "${REPO_ROOT}/frontend/${file}" ] || continue
    value="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}NEXT_PUBLIC_API_URL[[:space:]]*=[[:space:]]*//p' \
      "${REPO_ROOT}/frontend/${file}" | tail -n 1 | sed "s/^[\"']//; s/[\"'][[:space:]]*$//")"
    if [ -n "${value}" ]; then
      printf 'frontend/%s\t%s\n' "${file}" "${value}"
      return 0
    fi
  done
  return 1
}

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  api_url_line="$(next_public_api_url_source)" \
    || die "NEXT_PUBLIC_API_URL is not set: put it in frontend/.env.production (or the environment) before building."
  api_url_from="${api_url_line%%$'\t'*}"
  api_url="${api_url_line#*$'\t'}"
  echo "NEXT_PUBLIC_API_URL=${api_url} (from ${api_url_from})"
  case "${api_url}" in
    *localhost* | *127.0.0.1* | *'[::1]'*)
      echo "WARNING: NEXT_PUBLIC_API_URL points at this machine; browsers will not reach the API." >&2 ;;
  esac
  if [ -f "${REPO_ROOT}/frontend/.env.local" ]; then
    echo "WARNING: frontend/.env.local exists and overrides frontend/.env.production in production builds." >&2
  fi
fi

cd "${REPO_ROOT}"

# --- install and build -------------------------------------------------------

log "bun install --frozen-lockfile"
bun install --frozen-lockfile

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  # Each workspace's own build rather than turbo: turbo's cache key ignores
  # gitignored env files, so it could replay a frontend build made with other
  # NEXT_PUBLIC_* values.
  log "Building backend (prisma generate && nest build)"
  bun run --cwd backend build
  log "Building frontend (next build)"
  bun run --cwd frontend build
else
  log "SKIP_BUILD=1: using the existing builds"
fi

[ -f "${REPO_ROOT}/backend/dist/src/main.js" ] || die "backend/dist/src/main.js is missing: the backend build failed."
[ -f "${REPO_ROOT}/frontend/.next/BUILD_ID" ] || die "frontend/.next is missing: the frontend build failed."

# --- migrations (before any process runs the new code) -----------------------

if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  log "prisma migrate deploy"
  # prisma.config.ts loads DATABASE_URL from backend/.env.
  (cd backend && bunx prisma migrate deploy)
else
  log "SKIP_MIGRATE=1: not running migrations"
fi

# --- (re)start ---------------------------------------------------------------

# One process at a time: PM2 otherwise restarts two instances of an app in
# parallel. With api-ready.cjs (wait_ready) each API instance is back and
# answering before the next one stops; the Next.js workers are reloaded by
# cluster mode (new worker listening before the old one stops).
export PM2_CONCURRENT_ACTIONS=1

log "pm2 startOrReload ${ECOSYSTEM#"${REPO_ROOT}/"}"
"${PM2_CMD[@]}" startOrReload "${ECOSYSTEM}" --update-env
"${PM2_CMD[@]}" save

"${PM2_CMD[@]}" status
log "Deployed $(git -C "${REPO_ROOT}" describe --tags --always --dirty 2>/dev/null || echo 'unknown revision')"
