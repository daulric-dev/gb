#!/usr/bin/env bash
# `bun run preview`: build the backend and frontend, then run the production
# builds in the background in your normal PM2 daemon (`pm2 list`,
# `pm2 logs`, `pm2 monit` show them) with the development env files, and
# return to the shell. Stop with `bun run preview stop`. Development
# (`bun run dev`) is unchanged.
#
#   API  http://localhost:3001  (API_BASE_PORT; API_INSTANCES, default 1)
#   Web  http://localhost:3000  (WEB_PORT)
#
# Uses your default PM2 home (~/.pm2) unless PREVIEW_PM2_HOME is set. The
# apps are named gradebook-preview-* and are never `pm2 save`d. Uses pm2 from PATH, else PM2_VERSION via bunx.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PM2_VERSION="7.1.2"

die() { printf 'preview.sh: %s\n' "$*" >&2; exit 1; }

command -v node > /dev/null || die "node is not installed (Next.js needs Node >= 20.9)."
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  process.exit(maj > 20 || (maj === 20 && min >= 9) ? 0 : 1);
' || die "Node $(node --version) is too old: Next.js needs Node >= 20.9."
[ -f "${REPO_ROOT}/backend/.env" ] || die "backend/.env is missing (copy backend/.env.example)."

if [ -n "${PREVIEW_PM2_HOME:-}" ]; then
  export PM2_HOME="${PREVIEW_PM2_HOME}"
fi
if command -v pm2 > /dev/null; then
  pm2=(pm2)
else
  pm2=(bunx --package "pm2@${PM2_VERSION}" pm2)
fi

CONFIG="${SCRIPT_DIR}/preview.config.cjs"

if [ "${1:-}" = "stop" ]; then
  "${pm2[@]}" delete "${CONFIG}" > /dev/null 2>&1 || true
  echo "Preview stopped."
  exit 0
fi

cd "${REPO_ROOT}"
bunx turbo run build --filter=backend --filter=frontend

# startOrRestart so a preview already running is replaced.
"${pm2[@]}" startOrRestart "${CONFIG}" --update-env
"${pm2[@]}" list
cat <<HINT

Preview is running in the background (PM2):
  Web  http://localhost:${WEB_PORT:-3000}    API  http://localhost:${API_BASE_PORT:-3001}
  pm2 logs        follow logs
  pm2 monit       live dashboard
  bun run preview stop
HINT
