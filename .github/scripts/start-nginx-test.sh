#!/usr/bin/env bash
# Start an nginx:alpine container in host-network mode so its 127.0.0.1
# upstream references resolve to the mock servers running on the host.
# Container name is "nginx_test" — the cleanup step in the workflow removes it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NGINX_DIR="${NGINX_DIR:-${REPO_ROOT}/infrastructure/nginx}"

docker run -d --name nginx_test \
  --network host \
  -v "${NGINX_DIR}/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "${NGINX_DIR}/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine

sleep 2
echo "nginx_test container started"
