#!/usr/bin/env bash
# Verify the nginx reverse proxy is working correctly:
#   1. Each mock upstream (3004/3005/3006) is reachable directly.
#   2. nine sequential requests through nginx all succeed AND each of the
#      three upstreams is hit at least once (proves round-robin balancing).
# Assumes start-mock-upstreams.sh and start-nginx-test.sh have already run.
set -euo pipefail

echo "==> Pinging upstream ports directly"
for port in 3004 3005 3006; do
  response=$(curl -sf "http://localhost:$port" || echo "FAILED")
  echo "localhost:$port -> $response"
  if [ "$response" = "FAILED" ]; then
    echo "Upstream port $port is not responding"
    exit 1
  fi
done

echo "==> Pinging through the reverse proxy"
hit_3004=0; hit_3005=0; hit_3006=0; success=0
for i in $(seq 1 9); do
  response=$(curl -sf http://localhost || echo "FAILED")
  echo "Request $i: $response"
  if [[ "$response" != "FAILED" ]]; then
    success=$((success + 1))
    [[ "$response" == *"3004"* ]] && hit_3004=1
    [[ "$response" == *"3005"* ]] && hit_3005=1
    [[ "$response" == *"3006"* ]] && hit_3006=1
  fi
done

echo "$success/9 requests succeeded"
echo "Ports reached - 3004:$hit_3004  3005:$hit_3005  3006:$hit_3006"

if [ "$success" -ne 9 ]; then
  echo "Not all requests succeeded"
  exit 1
fi

if [ "$hit_3004" -ne 1 ] || [ "$hit_3005" -ne 1 ] || [ "$hit_3006" -ne 1 ]; then
  echo "Not all 3 upstream ports were reached"
  exit 1
fi

echo "Reverse proxy verified: all 9 requests succeeded, all 3 upstreams hit"
