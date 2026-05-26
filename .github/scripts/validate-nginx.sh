#!/usr/bin/env bash
# Validate nginx config syntax by running `nginx -t` inside the official
# nginx:alpine image. Mounts the local config files read-only so we exercise
# the exact files that will ship in the container.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NGINX_DIR="${NGINX_DIR:-${REPO_ROOT}/infrastructure/nginx}"

docker run --rm \
  -v "${NGINX_DIR}/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "${NGINX_DIR}/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine nginx -t
