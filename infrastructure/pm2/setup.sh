#!/usr/bin/env bash
# One-time PM2 setup on a server, as the user that will run GradeBook (not
# root):
#
#   infrastructure/pm2/setup.sh
#
# - installs PM2 globally if it is missing (npm, else `bun add -g`),
# - installs pm2-logrotate and configures rotation,
# - creates the log directory,
# - prints the `pm2 startup` command that makes PM2 start at boot (it needs
#   sudo, so this script only shows it; run it yourself).
#
# Re-running it is safe. Logrotate settings (defaults in brackets):
#   LOGROTATE_MAX_SIZE [50M]  rotate a log file above this size
#   LOGROTATE_RETAIN [14]     rotated files kept per log
#   LOGROTATE_COMPRESS [true] gzip rotated files
#   PM2_LOG_DIR [infrastructure/pm2/logs]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${PM2_LOG_DIR:-${SCRIPT_DIR}/logs}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run this as the deploy user, not root (PM2 keeps its state in that user's ~/.pm2)."

command -v node > /dev/null || die "node is not installed (PM2 and Next.js need Node >= 20.9)."
command -v bun > /dev/null || die "bun is not installed (the API runs on Bun 1.4.4)."

if ! command -v pm2 > /dev/null; then
  log "Installing PM2"
  if command -v npm > /dev/null; then
    npm install -g pm2
  else
    bun add -g pm2
  fi
  command -v pm2 > /dev/null \
    || die "pm2 was installed but is not on PATH (add the global bin directory, e.g. ~/.bun/bin, to PATH)."
fi
echo "PM2 $(pm2 --version)"

log "Log directory: ${LOG_DIR}"
mkdir -p "${LOG_DIR}"

log "pm2-logrotate"
if ! pm2 describe pm2-logrotate > /dev/null 2>&1; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size "${LOGROTATE_MAX_SIZE:-50M}"
pm2 set pm2-logrotate:retain "${LOGROTATE_RETAIN:-14}"
pm2 set pm2-logrotate:compress "${LOGROTATE_COMPRESS:-true}"
pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD_HH-mm-ss'
# Also rotate daily at midnight, whatever the size.
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

log "Start at boot"
# `pm2 startup` without root prints the exact sudo command for this init
# system and user; show it instead of running sudo here.
startup_cmd="$(pm2 startup 2>/dev/null | sed -n 's/^[[:space:]]*\(sudo .*\)$/\1/p' | tail -n 1 || true)"
if [ -n "${startup_cmd}" ]; then
  echo "Run this once (as a user with sudo) so PM2 starts at boot:"
  echo
  echo "  ${startup_cmd}"
else
  echo "Run \`pm2 startup\` and follow its instructions so PM2 starts at boot."
fi
cat <<'EOF'

Then deploy (infrastructure/pm2/deploy.sh); it runs `pm2 save`, which is the
process list PM2 restores at boot.
EOF
