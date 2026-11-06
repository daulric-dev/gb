set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PM2_DIR="${REPO_ROOT}/infrastructure/pm2"
cd "${REPO_ROOT}"

if command -v shellcheck > /dev/null; then
  echo "shellcheck"
  shellcheck "${PM2_DIR}"/*.sh
else
  echo "shellcheck not installed: skipped"
fi

echo "node --check"
for file in "${PM2_DIR}"/*.cjs; do
  node --check "${file}"
done

load() {
  local file="$1" expect="$2"
  shift 2
  if env -i PATH="${PATH}" HOME="${HOME}" "$@" \
    node -e 'const c = require(process.argv[1]); if (!c.apps?.length) process.exit(2);' \
    "${PM2_DIR}/${file}" > /dev/null 2>&1; then
    result=ok
  else
    result=fail
  fi
  if [ "${result}" != "${expect}" ]; then
    echo "FAIL: ${file} with [$*] expected ${expect}, got ${result}" >&2
    exit 1
  fi
  echo "  ${file} [$*] -> ${result} (expected)"
}

# The process files also read backend/.env, and the environment wins over
# it, so each case sets USE_REDIS and LOCAL_PREVIEW explicitly.
echo "process files and guards"
load ecosystem.config.cjs ok USE_REDIS=true LOCAL_PREVIEW=
load ecosystem.config.cjs ok API_INSTANCES=1 USE_REDIS= LOCAL_PREVIEW=
load ecosystem.config.cjs fail API_INSTANCES=2 USE_REDIS= LOCAL_PREVIEW=
load ecosystem.config.cjs fail API_INSTANCES=3 USE_REDIS=false LOCAL_PREVIEW=
load ecosystem.config.cjs fail USE_REDIS=true LOCAL_PREVIEW=true
load preview.config.cjs ok USE_REDIS= LOCAL_PREVIEW=

if command -v docker > /dev/null && docker info > /dev/null 2>&1; then
  CADDY_IMAGE="${CADDY_IMAGE:-$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\).*/\1/p' "${REPO_ROOT}/infrastructure/docker-compose.yml" | head -n 1)}"
  for sites in "api.example.com app.example.com" ":8080 :8081"; do
    read -r api web <<< "${sites}"
    echo "caddy validate pm2/Caddyfile (${CADDY_IMAGE}, SITE_ADDRESS=${api}, WEB_SITE_ADDRESS=${web})"
    docker run --rm \
      -e SITE_ADDRESS="${api}" -e WEB_SITE_ADDRESS="${web}" \
      -v "${PM2_DIR}:/etc/caddy:ro" "${CADDY_IMAGE}" \
      caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  done
  echo "caddy fmt pm2/Caddyfile"
  docker run --rm -v "${PM2_DIR}:/etc/caddy:ro" "${CADDY_IMAGE}" \
    caddy fmt /etc/caddy/Caddyfile > /dev/null
else
  echo "Docker not available: Caddyfile check skipped"
fi

echo "PM2 setup is valid"
