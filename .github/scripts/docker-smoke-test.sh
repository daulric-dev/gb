#!/usr/bin/env bash
# Smoke-test the running Compose stack end to end:
#   1. Every app replica reports a healthy Docker healthcheck.
#   2. Requests through nginx (:80) return 200, proving nginx reverse-proxies to
#      the app replicas over the Compose network via their service-name
#      upstreams (app1/app2/app3) - the wiring a 127.0.0.1 upstream would break.
#
# Assumes `docker compose ... up -d --wait` has already brought the stack up.
set -euo pipefail

COMPOSE="docker compose -f infrastructure/docker-compose.yml"

echo "==> Service status"
$COMPOSE ps

echo "==> App replicas must be healthy"
for svc in app1 app2 app3; do
  cid="$($COMPOSE ps -q "$svc")"
  if [ -z "$cid" ]; then
    echo "::error::$svc has no container"
    exit 1
  fi
  state="$(docker inspect -f '{{.State.Health.Status}}' "$cid")"
  echo "$svc -> $state"
  if [ "$state" != "healthy" ]; then
    echo "::error::$svc is not healthy ($state)"
    exit 1
  fi
done

echo "==> Requests through nginx (:80) must return 200"
for i in $(seq 1 9); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost/)"
  echo "request $i -> HTTP $code"
  if [ "$code" != "200" ]; then
    echo "::error::nginx returned $code (expected 200) - upstream wiring broken?"
    exit 1
  fi
done

echo "Smoke test passed: nginx proxies to healthy app replicas over the Compose network."
