#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NGINX_DIR="${NGINX_DIR:-${REPO_ROOT}/infrastructure/nginx}"

docker run --rm \
  --add-host app1:127.0.0.1 \
  --add-host app2:127.0.0.1 \
  --add-host app3:127.0.0.1 \
  -v "${NGINX_DIR}/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "${NGINX_DIR}/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine nginx -t
