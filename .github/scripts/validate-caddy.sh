#!/usr/bin/env bash
# Validates infrastructure/caddy/Caddyfile with the same Caddy image the
# production Compose stack runs, in both modes: automatic HTTPS for a hostname
# and plain HTTP (SITE_ADDRESS=:80). Runs locally too:
#   ./.github/scripts/validate-caddy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CADDY_DIR="${CADDY_DIR:-${REPO_ROOT}/infrastructure/caddy}"
# Keep in sync with the `caddy` service in infrastructure/docker-compose.yml.
CADDY_IMAGE="${CADDY_IMAGE:-$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\).*/\1/p' "${REPO_ROOT}/infrastructure/docker-compose.yml" | head -n 1)}"

if [ -z "${CADDY_IMAGE}" ]; then
  echo "Could not find the caddy image in infrastructure/docker-compose.yml" >&2
  exit 1
fi

for site in "api.example.com" ":80"; do
  echo "caddy validate (${CADDY_IMAGE}, SITE_ADDRESS=${site})"
  docker run --rm \
    -e SITE_ADDRESS="${site}" \
    -e ACME_EMAIL="ops@example.com" \
    -v "${CADDY_DIR}:/etc/caddy:ro" \
    "${CADDY_IMAGE}" \
    caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
done

# The Caddyfile must also be valid with ACME_EMAIL unset (it is optional).
docker run --rm -v "${CADDY_DIR}:/etc/caddy:ro" "${CADDY_IMAGE}" \
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile

# Formatting drift fails the check too (`caddy fmt --overwrite` fixes it;
# `caddy fmt` exits non-zero when the file is not formatted).
echo "caddy fmt (${CADDY_IMAGE})"
docker run --rm -v "${CADDY_DIR}:/etc/caddy:ro" "${CADDY_IMAGE}" \
  caddy fmt /etc/caddy/Caddyfile > /dev/null
echo "Caddyfile is valid and formatted"
