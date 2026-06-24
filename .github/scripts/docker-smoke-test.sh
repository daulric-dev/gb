#!/usr/bin/env bash
# Smoke-test the running Compose stack end to end: nginx (published on :80) must
# reverse-proxy to the app replicas over the Compose network and return 200,
# proving the service-name upstreams (app1/app2/app3) are wired correctly.
#
# Replica health is already guaranteed by `docker compose up -d --wait` in the
# workflow (it blocks until every app healthcheck passes), so we don't re-check
# it here - we just verify traffic flows through the proxy.
set -euo pipefail

COMPOSE="docker compose -f infrastructure/docker-compose.yml"

echo "==> Service status"
$COMPOSE ps -a || true

echo "==> Requests through nginx (:80) must return 200"
fail=0
for i in $(seq 1 9); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost/ || echo 000)"
  echo "request $i -> HTTP $code"
  [ "$code" = "200" ] || fail=1
done

if [ "$fail" -ne 0 ]; then
  echo "::error::nginx did not consistently return 200 through the proxy"
  exit 1
fi

echo "Smoke test passed: nginx (:80) proxies to the app replicas and returns 200."
